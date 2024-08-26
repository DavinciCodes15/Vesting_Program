pub mod helpers;
pub mod vesting_accounts;
pub mod errors;

use anchor_lang::prelude::*;
use anchor_spl::{
    metadata::{
        create_metadata_accounts_v3,
        mpl_token_metadata::types::DataV2,
        CreateMetadataAccountsV3,
    },
    token::{ mint_to, MintTo },
};
use crate::vesting_accounts::*;
use crate::errors::*;
use crate::helpers::{ calculate_amount_to_release, transfer_tokens_helper };

// Declare the program ID
declare_id!("5CzpYVBLG6akeQqbcGABdxffnCSmNqYDJc2JL7ZLe5jw");

#[program]
pub mod vesting_contract {
    use super::*;

    // Constant representing six months in minutes
    const SIX_MONTHS_IN_MINUTES: u64 = 180 * 24 * 60; // 180 days * 24 hours * 60 minutes

    /// Initializes a new token with metadata
    pub fn init_token(ctx: Context<InitToken>, metadata: InitTokenParams) -> Result<()> {
        // Create seeds for PDA (Program Derived Address)
        let seeds = &[
            "mint".as_bytes(),
            metadata.name.as_bytes(),
            &ctx.accounts.payer.key().to_bytes(),
            &[ctx.bumps.mint],
        ];
        let signer = [&seeds[..]];

        // Prepare token metadata
        let token_data: DataV2 = DataV2 {
            name: metadata.name.clone(),
            symbol: metadata.symbol,
            uri: metadata.uri,
            seller_fee_basis_points: 0,
            creators: None,
            collection: None,
            uses: None,
        };

        // Create metadata accounts using Metaplex
        let metadata_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_metadata_program.to_account_info(),
            CreateMetadataAccountsV3 {
                payer: ctx.accounts.payer.to_account_info(),
                update_authority: ctx.accounts.mint.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                metadata: ctx.accounts.metadata.to_account_info(),
                mint_authority: ctx.accounts.mint.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                rent: ctx.accounts.rent.to_account_info(),
            },
            &signer
        );

        // Call Metaplex instruction to create metadata accounts
        create_metadata_accounts_v3(metadata_ctx, token_data, false, true, None)?;

        msg!("Token mint created successfully.");

        Ok(())
    }

    /// Mints new tokens to a specified account
    pub fn mint_tokens(
        ctx: Context<MintTokens>,
        metadata: InitTokenParams,
        quantity: u64
    ) -> Result<()> {
        // Create seeds for PDA (Program Derived Address)
        let seeds = &[
            "mint".as_bytes(),
            metadata.name.as_bytes(),
            &ctx.accounts.payer.key().to_bytes(),
            &[ctx.bumps.mint],
        ];
        let signer = [&seeds[..]];

        // Mint tokens using the token program
        mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    authority: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.destination.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                },
                &signer
            ),
            quantity
        )?;

        Ok(())
    }

    /// Exchanges tokens between user and dual auth accounts
    #[inline(never)]
    pub fn exchange(ctx: Context<Exchange>, amount: u64) -> Result<()> {
        let dual_auth_account = &mut ctx.accounts.dual_auth_account;
        let user_account = &ctx.accounts.user;

        // Initialize the DualAuthAccount if it's new
        if dual_auth_account.user == Pubkey::default() {
            // Set up the dual auth account with user and backend keys
            dual_auth_account.user = *user_account.key;
            dual_auth_account.backend = *ctx.accounts.backend.key;
        }

        // Check if the amount is sufficient (at least 6 months worth)
        if amount < SIX_MONTHS_IN_MINUTES {
            return Err(VestingErrorCode::MinimumAmountNotMet.into());
        }

        // Transfer tokens from user to dual auth valued token account
        transfer_tokens_helper(
            &ctx.accounts.user_valued_token_account,
            &ctx.accounts.dual_valued_token_account,
            ctx.accounts.user.to_account_info(),
            &ctx.accounts.user,
            &ctx.accounts.backend,
            &ctx.accounts.token_program,
            amount,
            ctx.bumps.dual_auth_account
        )?;

        // Transfer equivalent tokens from backend to dual auth escrow token account
        transfer_tokens_helper(
            &ctx.accounts.backend_escrow_token_account,
            &ctx.accounts.dual_escrow_token_account,
            ctx.accounts.backend.to_account_info(),
            &ctx.accounts.user,
            &ctx.accounts.backend,
            &ctx.accounts.token_program,
            amount,
            ctx.bumps.dual_auth_account
        )?;

        Ok(())
    }

    /// Transfers tokens between accounts under dual authorization
    pub fn transfer_tokens(ctx: Context<TransferTokens>, amount: u64) -> Result<()> {
        // Use the helper function to transfer tokens
        transfer_tokens_helper(
            &ctx.accounts.from,
            &ctx.accounts.to,
            ctx.accounts.dual_auth_account.to_account_info(),
            &ctx.accounts.user,
            &ctx.accounts.backend,
            &ctx.accounts.token_program,
            amount,
            ctx.bumps.dual_auth_account
        )?;

        Ok(())
    }

    /// Creates a new vesting session
    pub fn create_vesting_session(ctx: Context<CreateVestingSession>, amount: u64) -> Result<()> {
        let vesting_account = &mut ctx.accounts.vesting_sessions_account;
        let vesting_session = &mut ctx.accounts.vesting_session_account;

        // Initialize vesting session with details
        vesting_session.id = vesting_account.last_session_id;
        vesting_session.vesting_sessions_account = vesting_account.key();
        vesting_session.amount = amount;
        vesting_session.amount_withdrawn = 0;
        vesting_session.start_date = Clock::get()?.unix_timestamp as u64;
        vesting_session.last_withdraw_at = 0;
        vesting_session.cancelled_at = 0;

        // Increment the session ID for the next vesting session
        vesting_account.last_session_id += 1;

        // Transfer tokens from dual escrow to backend escrow
        transfer_tokens_helper(
            &ctx.accounts.dual_escrow_token_account,
            &ctx.accounts.backend_escrow_token_account,
            ctx.accounts.dual_auth_account.to_account_info(),
            &ctx.accounts.user,
            &ctx.accounts.backend,
            &ctx.accounts.token_program,
            amount,
            ctx.bumps.dual_auth_account
        )?;

        Ok(())
    }

    /// Withdraws vested tokens from a session
    pub fn session_withdraw(ctx: Context<SessionWithdraw>) -> Result<()> {
        let vesting_session = &mut ctx.accounts.vesting_session_account;

        // Calculate amount to release using the helper function
        let amount_to_release = calculate_amount_to_release(vesting_session)?;

        if amount_to_release > 0 {
            // Transfer releasable tokens
            transfer_tokens_helper(
                &ctx.accounts.dual_valued_token_account,
                &ctx.accounts.user_valued_token_account,
                ctx.accounts.dual_auth_account.to_account_info(),
                &ctx.accounts.user,
                &ctx.accounts.backend,
                &ctx.accounts.token_program,
                amount_to_release,
                ctx.bumps.dual_auth_account
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
                &ctx.accounts.dual_valued_token_account,
                &ctx.accounts.user_valued_token_account,
                ctx.accounts.dual_auth_account.to_account_info(),
                &ctx.accounts.user,
                &ctx.accounts.backend,
                &ctx.accounts.token_program,
                valued_amount_to_release,
                ctx.bumps.dual_auth_account
            )?;

            // Update vesting session state
            vesting_session.amount_withdrawn = vesting_session.amount_withdrawn
                .checked_add(valued_amount_to_release)
                .ok_or(VestingErrorCode::ArithmeticOverflow)?;

            vesting_session.last_withdraw_at = Clock::get()?.unix_timestamp as u64;
        }

        if escrow_amount_to_get_back > 0 {
            // Return remaining tokens to escrow
            transfer_tokens_helper(
                &ctx.accounts.backend_escrow_token_account,
                &ctx.accounts.dual_escrow_token_account,
                ctx.accounts.backend.to_account_info(),
                &ctx.accounts.user,
                &ctx.accounts.backend,
                &ctx.accounts.token_program,
                escrow_amount_to_get_back,
                ctx.bumps.dual_auth_account
            )?;
        }

        // Mark the session as cancelled
        vesting_session.cancelled_at = Clock::get()?.unix_timestamp as u64;
        Ok(())
    }
}
