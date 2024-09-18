/// Helper functions for the contract

use anchor_lang::{ prelude::*, solana_program::{ program::invoke, system_instruction::transfer } };
use anchor_spl::token_interface::{ transfer_checked, Mint, TokenAccount, TransferChecked };
use crate::{ VestingErrorCode, VestingSession };

///  update the account's lamports to the minimum balance required by the rent sysvar
pub fn update_account_lamports_to_minimum_balance<'info>(
    account: AccountInfo<'info>,
    payer: AccountInfo<'info>,
    system_program: AccountInfo<'info>
) -> Result<()> {
    let extra_lamports = Rent::get()?.minimum_balance(account.data_len()) - account.get_lamports();
    if extra_lamports > 0 {
        invoke(
            &transfer(payer.key, account.key, extra_lamports),
            &[payer, account, system_program]
        )?;
    }
    Ok(())
}

/// Helper function to transfer tokens
pub fn transfer_tokens_helper<'info>(
    from: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    to: &InterfaceAccount<'info, TokenAccount>,
    authority: &AccountInfo<'info>,
    owner: &AccountInfo<'info>,
    user: &Signer<'info>,
    backend: &Signer<'info>,
    valued_token_mint: &InterfaceAccount<'info, Mint>,
    escrow_token_mint: &InterfaceAccount<'info, Mint>,
    token_program: &AccountInfo<'info>,
    amount: u64,
    bump: u8
) -> Result<()> {
    // Create seeds for PDA signing
    let valued_mint = valued_token_mint.key();
    let escrow_mint = escrow_token_mint.key();
    let seeds = &[
        b"dual_auth",
        owner.key.as_ref(),
        user.key.as_ref(),
        backend.key.as_ref(),
        valued_mint.as_ref(),
        escrow_mint.as_ref(),
        &[bump],
    ];
    let signer = &[&seeds[..]];

    // Set up the accounts for the transfer
    let cpi_accounts = TransferChecked {
        from: from.to_account_info(),
        mint: mint.to_account_info(),
        to: to.to_account_info(),
        authority: authority.to_account_info(),
    };
    let cpi_program = token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);

    // Execute the transfer
    transfer_checked(cpi_ctx, amount, mint.decimals)?;

    Ok(())
}

/// Calculates the amount of tokens to release in a vesting session
pub fn calculate_amount_to_release(vesting_session: &VestingSession) -> Result<u64> {
    // Constants
    const SIX_MONTHS_IN_MINUTES: u64 = 180 * 24 * 60; // 180 days * 24 hours * 60 minutes

    // Get current time
    let clock = Clock::get()?;
    let now = clock.unix_timestamp as u64;
    let current_time_minutes = now.checked_div(60).ok_or(VestingErrorCode::DivisionByZero)?;

    // Calculate vesting end time
    let vesting_end_time = vesting_session.start_date
        .checked_div(60)
        .ok_or(VestingErrorCode::DivisionByZero)?
        .checked_add(SIX_MONTHS_IN_MINUTES)
        .ok_or(VestingErrorCode::ArithmeticOverflow)?;

    // Cap the current time at the end of the vesting period
    let current_time = std::cmp::min(current_time_minutes, vesting_end_time);

    // Calculate elapsed time since last withdrawal or start
    let elapsed_minutes = if vesting_session.last_withdraw_at > 0 {
        current_time.saturating_sub(
            vesting_session.last_withdraw_at
                .checked_div(60)
                .ok_or(VestingErrorCode::DivisionByZero)?
        )
    } else {
        current_time.saturating_sub(
            vesting_session.start_date.checked_div(60).ok_or(VestingErrorCode::DivisionByZero)?
        )
    };

    // Calculate amount to be released
    let amount_per_minute = vesting_session.amount
        .checked_div(SIX_MONTHS_IN_MINUTES)
        .ok_or(VestingErrorCode::DivisionByZero)?;
    let amount_released = elapsed_minutes
        .checked_mul(amount_per_minute)
        .ok_or(VestingErrorCode::ArithmeticOverflow)?;

    // Ensure we're not releasing more than what's available
    let available_to_withdraw = vesting_session.amount.saturating_sub(
        vesting_session.amount_withdrawn
    );
    let amount_to_release = std::cmp::min(amount_released, available_to_withdraw);

    Ok(amount_to_release)
}
