use crate::{VaultAccount, VestingErrorCode, VestingSession};
/// Helper functions for the contract
use anchor_lang::{
    prelude::*,
    solana_program::{program::invoke, system_instruction::transfer},
};
use anchor_spl::token_interface::{
    mint_to, transfer_checked, Mint, MintTo, Token2022, TokenAccount, TransferChecked,
};

///  update the account's lamports to the minimum balance required by the rent sysvar
pub fn update_account_lamports_to_minimum_balance<'info>(
    account: AccountInfo<'info>,
    payer: AccountInfo<'info>,
    system_program: AccountInfo<'info>,
) -> Result<()> {
    let account_lamports = account.get_lamports();
    let account_required_min_balance = Rent::get()?.minimum_balance(account.data_len());
    if account_lamports < account_required_min_balance {
        let extra_lamports = account_required_min_balance - account_lamports;
        invoke(
            &transfer(payer.key, account.key, extra_lamports),
            &[payer, account, system_program],
        )?;
    }
    Ok(())
}

pub fn transfer_escrow_from_vault<'info>(
    token_program: &Program<'info, Token2022>,
    vault_account: &Account<'info, VaultAccount>,
    escrow_vault_token_account: &InterfaceAccount<'info, TokenAccount>,
    user_escrow_token_account: &InterfaceAccount<'info, TokenAccount>,
    valued_token_mint: &InterfaceAccount<'info, Mint>,
    escrow_token_mint: &InterfaceAccount<'info, Mint>,
    vault_bump: u8,
    amount: u64,
) -> Result<()> {
    let vault_seed = &[
        b"token_vault".as_ref(),
        &valued_token_mint.key().to_bytes(),
        &escrow_token_mint.key().to_bytes(),
        &[vault_bump],
    ];
    let vault_signer = &[&vault_seed[..]];

    let vault_escrow_balance = escrow_vault_token_account.amount;
    let amount_to_transfer = if vault_escrow_balance >= amount {
        amount
    } else if vault_escrow_balance > 0 {
        vault_escrow_balance
    } else {
        0
    };
    let amount_to_mint = amount
        .checked_sub(amount_to_transfer)
        .ok_or(VestingErrorCode::ArithmeticOverflow)?;

    if amount_to_transfer > 0 {
        transfer_tokens(
            &escrow_vault_token_account,
            &escrow_token_mint,
            &user_escrow_token_account,
            &token_program,
            amount_to_transfer,
            vault_account.to_account_info(),
            Some(vault_signer),
        )?;
    }

    if amount_to_mint > 0 {
        mint_to(
            CpiContext::new_with_signer(
                token_program.to_account_info(),
                MintTo {
                    mint: escrow_token_mint.to_account_info(),
                    to: user_escrow_token_account.to_account_info(),
                    authority: vault_account.to_account_info(),
                },
                vault_signer,
            ),
            amount_to_mint,
        )?;
    }

    Ok(())
}

/// Helper function to transfer tokens
pub fn transfer_tokens<'info>(
    from: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    to: &InterfaceAccount<'info, TokenAccount>,
    token_program: &AccountInfo<'info>,
    amount: u64,
    authority: AccountInfo<'info>,
    pda_signer: Option<&[&[&[u8]]; 1]>,
) -> Result<()> {
    // Set up the accounts for the transfer
    let cpi_accounts = TransferChecked {
        from: from.to_account_info(),
        mint: mint.to_account_info(),
        to: to.to_account_info(),
        authority: authority,
    };
    let cpi_program = token_program.to_account_info();

    let cpi_ctx = match pda_signer {
        Some(signer) => CpiContext::new_with_signer(cpi_program, cpi_accounts, signer),
        None => CpiContext::new(cpi_program, cpi_accounts),
    };

    // Execute the transfer
    transfer_checked(cpi_ctx, amount, mint.decimals)?;

    Ok(())
}

/// Calculates the amount of tokens to release in a vesting session
pub fn calculate_amount_to_release(vesting_session: &VestingSession) -> Result<u64> {
    // Constants
    const SIX_MONTHS_IN_MINUTES: u64 = 180 * 24 * 60 * 60; // 180 days * 24 hours * 60 minutes
    const SIX_MONTHS_IN_SECONDS: u64 = SIX_MONTHS_IN_MINUTES * 60; // SIX_MONTHS_IN_MINUTES * 60 seconds

    // Get current time
    let clock = Clock::get()?;
    let current_time_seconds = clock.unix_timestamp as u64;

    // Calculate vesting end time
    let vesting_start = vesting_session.start_date;
    let vesting_end_time = vesting_start
        .checked_add(SIX_MONTHS_IN_SECONDS)
        .ok_or(VestingErrorCode::ArithmeticOverflow)?;

    // Check if vesting period has ended
    if current_time_seconds >= vesting_end_time {
        // Vesting period has ended, return full remaining amount
        return Ok(vesting_session
            .amount
            .saturating_sub(vesting_session.amount_withdrawn));
    }

    // Calculate elapsed time since last withdrawal or start
    let last_withdraw_seconds = vesting_session.last_withdraw_at;
    let elapsed_seconds = if last_withdraw_seconds > 0 {
        current_time_seconds.saturating_sub(last_withdraw_seconds)
    } else {
        current_time_seconds.saturating_sub(vesting_start)
    };

    // Calculate amount to be released
    let amount_per_minute = vesting_session
        .amount
        .checked_div(SIX_MONTHS_IN_MINUTES)
        .ok_or(VestingErrorCode::DivisionByZero)?;
    let amount_released = elapsed_seconds
        .checked_div(60)
        .ok_or(VestingErrorCode::DivisionByZero)?
        .checked_mul(amount_per_minute)
        .ok_or(VestingErrorCode::ArithmeticOverflow)?;

    // Ensure we're not releasing more than what's available
    let available_to_withdraw = vesting_session
        .amount
        .saturating_sub(vesting_session.amount_withdrawn);
    let amount_to_release = std::cmp::min(amount_released, available_to_withdraw);

    Ok(amount_to_release)
}

pub mod token_2022_validations {
    use crate::VestingErrorCode;
    use anchor_lang::err;
    use anchor_lang::prelude::{AccountInfo, Pubkey};
    use anchor_spl::token::spl_token;
    use anchor_spl::token_2022::spl_token_2022;
    use anchor_spl::token_interface::spl_token_2022::extension::ExtensionType;
    use anchor_spl::token_interface::spl_token_2022::extension::{
        BaseStateWithExtensions, StateWithExtensions,
    };

    const VALID_LIQUIDITY_TOKEN_EXTENSIONS: &[ExtensionType] = &[
        ExtensionType::MintCloseAuthority,
        ExtensionType::MetadataPointer,
        ExtensionType::PermanentDelegate,
        ExtensionType::TransferFeeConfig,
        ExtensionType::TokenMetadata,
        ExtensionType::TransferHook,
    ];

    pub fn validate_token_extensions(mint_acc_info: &AccountInfo) -> anchor_lang::Result<()> {
        if mint_acc_info.owner == &spl_token::id() {
            return Ok(());
        }

        let mint_data = mint_acc_info.data.borrow();
        let mint = StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&mint_data)?;

        for mint_ext in mint.get_extension_types()? {
            if !VALID_LIQUIDITY_TOKEN_EXTENSIONS.contains(&mint_ext) {
                return err!(VestingErrorCode::UnsupportedTokenExtension);
            }
            if mint_ext == ExtensionType::TransferFeeConfig {
                let ext = mint
                    .get_extension::<spl_token_2022::extension::transfer_fee::TransferFeeConfig>(
                    )?;
                if <u16>::from(ext.older_transfer_fee.transfer_fee_basis_points) != 0
                    || <u16>::from(ext.newer_transfer_fee.transfer_fee_basis_points) != 0
                {
                    return err!(VestingErrorCode::UnsupportedTokenExtension);
                }
            } else if mint_ext == ExtensionType::TransferHook {
                let ext =
                    mint.get_extension::<spl_token_2022::extension::transfer_hook::TransferHook>()?;
                let hook_program_id: Option<Pubkey> = ext.program_id.into();
                if hook_program_id.is_some() {
                    return err!(VestingErrorCode::UnsupportedTokenExtension);
                }
            }
        }
        Ok(())
    }
}
