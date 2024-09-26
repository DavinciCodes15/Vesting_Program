pub mod helpers;
pub mod vesting_accounts;
pub mod errors;

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    MintTo,
    mint_to,
    token_metadata_initialize,
    TokenMetadataInitialize,
};

use crate::vesting_accounts::*;
use crate::errors::*;
use crate::helpers::{
    // calculate_amount_to_release,
    transfer_tokens_helper,
    update_account_lamports_to_minimum_balance,
};

// Declare the program ID
declare_id!("3qUf3hWYhvjhbwMfVjushfDG5nWmg8VCAtG5cAQrDMdr");

#[program]
pub mod vesting_contract {
    use helpers::calculate_amount_to_release;

    use super::*;

    // Constant representing six months in minutes
    // const SIX_MONTHS_IN_MINUTES: u64 = 180 * 24 * 60; // 180 days * 24 hours * 60 minutes

    /// Initializes a new token with metadata
    pub fn init_escrow_token(
        ctx: Context<InitEscrowToken>,
        metadata: InitEscrowTokenParams
    ) -> Result<()> {
        // Create seeds for PDA (Program Derived Address)
        let seeds = &[
            "mint".as_bytes(),
            metadata.name.as_bytes(),
            &ctx.accounts.valued_token_mint.key().to_bytes(),
            &ctx.accounts.owner.key().to_bytes(),
            &ctx.accounts.backend.key().to_bytes(),
            &[ctx.bumps.escrow_token_mint],
        ];
        let signer = [&seeds[..]];

        // Initialize token metadata
        token_metadata_initialize(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TokenMetadataInitialize {
                    token_program_id: ctx.accounts.token_program.to_account_info(),
                    mint: ctx.accounts.escrow_token_mint.to_account_info(),
                    metadata: ctx.accounts.escrow_token_mint.to_account_info(),
                    mint_authority: ctx.accounts.backend.to_account_info(),
                    update_authority: ctx.accounts.backend.to_account_info(),
                },
                &signer
            ),
            metadata.name.clone(),
            metadata.symbol,
            metadata.uri
        )?;

        // Update the mint account to the minimum balance
        update_account_lamports_to_minimum_balance(
            ctx.accounts.escrow_token_mint.to_account_info(),
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.system_program.to_account_info()
        )?;

        msg!("Token mint created successfully.");

        Ok(())
    }

    /// Initializes a new vault account
    pub fn initialize_vault_account(ctx: Context<InitializVaultAccount>) -> Result<()> {
        ctx.accounts.vault_account.owner = ctx.accounts.owner.key();
        ctx.accounts.vault_account.backend = ctx.accounts.backend.key();
        ctx.accounts.vault_account.valued_token_mint = ctx.accounts.valued_token_mint.key();
        ctx.accounts.vault_account.escrow_token_mint = ctx.accounts.escrow_token_mint.key();
        Ok(())
    }

    /// Mints new tokens to a specified account
    pub fn mint_escrow_tokens(
        ctx: Context<MintEscrowTokens>,
        _metadata: InitEscrowTokenParams
    ) -> Result<()> {
        // Mint tokens to escrow_vault_token_account
        mint_to(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), MintTo {
                mint: ctx.accounts.escrow_token_mint.to_account_info(),
                to: ctx.accounts.escrow_vault_token_account.to_account_info(),
                authority: ctx.accounts.backend.to_account_info(),
            }),
            ctx.accounts.valued_token_mint.supply
        )?;

        Ok(())
    }

    /// Exchanges tokens between user and dual auth accounts
    #[inline(never)]
    pub fn exchange(ctx: Context<Exchange>, amount: u64) -> Result<()> {
        // Check if the amount is sufficient (at the minimum value)
        let one_token = (10u64).pow(ctx.accounts.valued_token_mint.decimals as u32);
        require!(amount >= one_token, VestingErrorCode::MinimumAmountNotMet);

        // Transfer tokens from user to vault valued token account
        transfer_tokens_helper(
            &ctx.accounts.vault_account,
            &ctx.accounts.user_valued_token_account,
            &ctx.accounts.valued_token_mint,
            &ctx.accounts.valued_vault_token_account,
            &Some(ctx.accounts.user.to_account_info()),
            &ctx.accounts.owner,
            &ctx.accounts.backend,
            &ctx.accounts.valued_token_mint,
            &ctx.accounts.escrow_token_mint,
            &ctx.accounts.valued_token_program,
            amount,
            ctx.bumps.vault_account
        )?;

        // Transfer equivalent tokens from escrow vault account to the user token account
        transfer_tokens_helper(
            &ctx.accounts.vault_account,
            &ctx.accounts.escrow_vault_token_account,
            &ctx.accounts.escrow_token_mint,
            &ctx.accounts.user_escrow_token_account,
            &None,
            &ctx.accounts.owner,
            &ctx.accounts.backend,
            &ctx.accounts.valued_token_mint,
            &ctx.accounts.escrow_token_mint,
            &ctx.accounts.token_program,
            amount,
            ctx.bumps.vault_account
        )?;

        Ok(())
    }

    /// Creates a new vesting session
    pub fn create_vesting_session(ctx: Context<CreateVestingSession>, amount: u64) -> Result<()> {
        let vesting_account = &mut ctx.accounts.vesting_sessions_account;
        let vesting_session = &mut ctx.accounts.vesting_session_account;

        // Check if the amount is sufficient (at the minimum value)
        let one_token = (10u64).pow(ctx.accounts.valued_token_mint.decimals as u32);
        require!(amount >= one_token, VestingErrorCode::MinimumAmountNotMet);

        // Initialize vesting session with details
        vesting_session.id = vesting_account.last_session_id;
        vesting_session.user = ctx.accounts.user.key();
        vesting_session.vesting_sessions_account = vesting_account.key();
        vesting_session.amount = amount;
        vesting_session.amount_withdrawn = 0;
        vesting_session.start_date = Clock::get()?.unix_timestamp as u64;
        vesting_session.last_withdraw_at = 0;
        vesting_session.cancelled_at = 0;

        // Increment the session ID for the next vesting session
        vesting_account.last_session_id += 1;
        vesting_account.user = ctx.accounts.user.key();

        // Transfer tokens from the user escrow account back to vault escrow account
        transfer_tokens_helper(
            &ctx.accounts.vault_account,
            &ctx.accounts.user_escrow_token_account,
            &ctx.accounts.escrow_token_mint,
            &ctx.accounts.escrow_vault_token_account,
            &Some(ctx.accounts.user.to_account_info()),
            &ctx.accounts.owner,
            &ctx.accounts.backend,
            &ctx.accounts.valued_token_mint,
            &ctx.accounts.escrow_token_mint,
            &ctx.accounts.token_program,
            amount,
            ctx.bumps.vault_account
        )?;

        Ok(())
    }

    /// Withdraws vested tokens from a session
    pub fn session_withdraw(ctx: Context<SessionWithdraw>) -> Result<()> {
        let vesting_session = &mut ctx.accounts.vesting_session_account;

        require!(
            vesting_session.cancelled_at == 0,
            VestingErrorCode::InteractingWithCanceledSession
        );

        // Calculate amount to release using the helper function
        let amount_to_release = calculate_amount_to_release(vesting_session)?;

        if amount_to_release > 0 {
            // Transfer releasable tokens
            transfer_tokens_helper(
                &ctx.accounts.vault_account,
                &ctx.accounts.valued_vault_token_account,
                &ctx.accounts.valued_token_mint,
                &ctx.accounts.user_valued_token_account,
                &None,
                &ctx.accounts.owner,
                &ctx.accounts.backend,
                &ctx.accounts.valued_token_mint,
                &ctx.accounts.escrow_token_mint,
                &ctx.accounts.token_program,
                amount_to_release,
                ctx.bumps.vault_account
            )?;

            // Update vesting session state
            vesting_session.amount_withdrawn = vesting_session.amount_withdrawn
                .checked_add(amount_to_release)
                .ok_or(VestingErrorCode::ArithmeticOverflow)?;
            vesting_session.last_withdraw_at = Clock::get()?.unix_timestamp as u64;

            return Ok(());
        }

        Err(VestingErrorCode::InsufficientWithdrawalAmount.into())
    }

    /// Cancels an ongoing vesting session
    pub fn session_cancel(ctx: Context<SessionCancelation>) -> Result<()> {
        let vesting_session = &mut ctx.accounts.vesting_session_account;

        require!(
            vesting_session.cancelled_at == 0,
            VestingErrorCode::InteractingWithCanceledSession
        );

        // Calculate amount to release using the helper function
        let valued_amount_to_release = calculate_amount_to_release(vesting_session)?;

        // Calculate the amount to return to escrow
        let escrow_amount_to_get_back = vesting_session.amount
            .checked_sub(vesting_session.amount_withdrawn)
            .ok_or(VestingErrorCode::ArithmeticOverflow)?
            .checked_sub(valued_amount_to_release)
            .ok_or(VestingErrorCode::ArithmeticOverflow)?;

        if valued_amount_to_release > 0 {
            // Transfer releasable tokens to user
            transfer_tokens_helper(
                &ctx.accounts.vault_account,
                &ctx.accounts.valued_vault_token_account,
                &ctx.accounts.valued_token_mint,
                &ctx.accounts.user_valued_token_account,
                &None,
                &ctx.accounts.owner,
                &ctx.accounts.backend,
                &ctx.accounts.valued_token_mint,
                &ctx.accounts.escrow_token_mint,
                &ctx.accounts.valued_token_program,
                valued_amount_to_release,
                ctx.bumps.vault_account
            )?;

            // Update vesting session state
            vesting_session.amount_withdrawn = vesting_session.amount_withdrawn
                .checked_add(valued_amount_to_release)
                .ok_or(VestingErrorCode::ArithmeticOverflow)?;

            vesting_session.last_withdraw_at = Clock::get()?.unix_timestamp as u64;
        }

        if escrow_amount_to_get_back > 0 {
            // Return remaining tokens to user escrow account
            transfer_tokens_helper(
                &ctx.accounts.vault_account,
                &ctx.accounts.escrow_vault_token_account,
                &ctx.accounts.escrow_token_mint,
                &ctx.accounts.user_escrow_token_account,
                &None,
                &ctx.accounts.owner,
                &ctx.accounts.backend,
                &ctx.accounts.valued_token_mint,
                &ctx.accounts.escrow_token_mint,
                &ctx.accounts.token_program,
                escrow_amount_to_get_back,
                ctx.bumps.vault_account
            )?;
        }

        // Mark the session as cancelled
        vesting_session.cancelled_at = Clock::get()?.unix_timestamp as u64;
        Ok(())
    }

    /// Exits an ongoing vesting session
    pub fn session_exit(ctx: Context<SessionCancelation>) -> Result<()> {
        let vesting_session = &mut ctx.accounts.vesting_session_account;

        require!(
            vesting_session.cancelled_at == 0,
            VestingErrorCode::InteractingWithCanceledSession
        );

        // Calculate the amount to return back to the user
        let amount = vesting_session.amount
            .checked_sub(vesting_session.amount_withdrawn)
            .ok_or(VestingErrorCode::ArithmeticOverflow)?;

        if amount > 0 {
            // Transfer releasable tokens to user
            transfer_tokens_helper(
                &ctx.accounts.vault_account,
                &ctx.accounts.valued_vault_token_account,
                &ctx.accounts.valued_token_mint,
                &ctx.accounts.user_valued_token_account,
                &None,
                &ctx.accounts.owner,
                &ctx.accounts.backend,
                &ctx.accounts.valued_token_mint,
                &ctx.accounts.escrow_token_mint,
                &ctx.accounts.valued_token_program,
                amount,
                ctx.bumps.vault_account
            )?;
        }

        // Update vesting session state
        vesting_session.amount_withdrawn = vesting_session.amount_withdrawn
            .checked_add(amount)
            .ok_or(VestingErrorCode::ArithmeticOverflow)?;

        vesting_session.last_withdraw_at = Clock::get()?.unix_timestamp as u64;

        // Mark the session as cancelled
        vesting_session.cancelled_at = Clock::get()?.unix_timestamp as u64;
        Ok(())
    }
}
