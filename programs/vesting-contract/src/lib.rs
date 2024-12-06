pub mod errors;
pub mod events;
pub mod helpers;
pub mod vesting_accounts;

use crate::errors::*;
use crate::events::*;
use crate::vesting_accounts::*;
use anchor_lang::prelude::*;

// Declare the program ID
declare_id!("GZ5Q5XdSv4PARXMn5ZGAvF7KjafLStsCGwEAzjowpqsw");

#[program]
pub mod vesting_contract {

    use crate::helpers::{
        calculate_amount_to_release, transfer_escrow_from_vault, transfer_tokens,
        update_account_lamports_to_minimum_balance,
    };

    use anchor_spl::token_interface::{
        token_metadata_initialize, token_metadata_update_field, TokenMetadataInitialize,
        TokenMetadataUpdateField,
    };
    use spl_token_metadata_interface::state::Field;

    use super::*;

    /// Minimum value which a currency can provide amounts every minute (equivalent to the amount of minutes in 6 months)
    const MIN_DIVISIBLE_BY_VESTING_PERIOD: u64 = 180 * 24 * 60;

    pub fn set_backend_account(
        ctx: Context<SetBackendAccountCtx>,
        metadata: SetBackendAccountParams,
    ) -> Result<()> {
        let program_authority = &ctx.accounts.program_data.upgrade_authority_address;
        let tx_payer = &ctx.accounts.payer.key();
        let backend_data = &mut ctx.accounts.backend_data;

        let is_program_authority = match program_authority {
            Some(authority) => tx_payer == authority,
            None => false,
        };
        let is_backend_change_authority = match &backend_data.change_authority {
            Some(authority) => tx_payer == authority,
            None => false,
        };

        if is_program_authority || is_backend_change_authority {
            backend_data.backend_account = metadata.new_backend_account;
            if metadata.new_authority.is_some() {
                backend_data.change_authority = metadata.new_authority;
            }
        } else {
            return err!(VestingErrorCode::UnathorizedToExecute);
        }

        Ok(())
    }

    /// Initializes a new token with metadata
    pub fn init_escrow_token(
        ctx: Context<InitEscrowToken>,
        metadata: InitEscrowTokenParams,
    ) -> Result<()> {
        let vault_seed = &[
            b"token_vault".as_ref(),
            &ctx.accounts.valued_token_mint.key().to_bytes(),
            &ctx.accounts.escrow_token_mint.key().to_bytes(),
            &[ctx.bumps.vault_account],
        ];
        let vault_signer = &[&vault_seed[..]];

        // Initialize token metadata
        token_metadata_initialize(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TokenMetadataInitialize {
                    token_program_id: ctx.accounts.token_program.to_account_info(),
                    mint: ctx.accounts.escrow_token_mint.to_account_info(),
                    metadata: ctx.accounts.escrow_token_mint.to_account_info(),
                    mint_authority: ctx.accounts.vault_account.to_account_info(),
                    update_authority: ctx.accounts.vault_account.to_account_info(),
                },
                vault_signer,
            ),
            metadata.name.clone(),
            metadata.symbol,
            metadata.uri,
        )?;

        // Update the mint account to the minimum balance
        update_account_lamports_to_minimum_balance(
            ctx.accounts.escrow_token_mint.to_account_info(),
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        )?;

        ctx.accounts.vault_account.creator = ctx.accounts.payer.key();
        ctx.accounts.vault_account.valued_token_mint = ctx.accounts.valued_token_mint.key();
        ctx.accounts.vault_account.escrow_token_mint = ctx.accounts.escrow_token_mint.key();
        ctx.accounts.vault_account.app_id = metadata.app_id;

        emit!(EscrowCreatedEvent {
            creator: ctx.accounts.payer.key(),
            valued_token_mint: ctx.accounts.valued_token_mint.key(),
            escrow_token_mint: ctx.accounts.escrow_token_mint.key(),
            vault_account: ctx.accounts.vault_account.key(),
            app_id: ctx.accounts.vault_account.app_id.clone(),
        });

        Ok(())
    }

    pub fn init_vault_token_accounts(ctx: Context<InitVaultTokenAccounts>) -> Result<()> {
        emit!(VaultAccountInitializedEvent {
            vault_account: ctx.accounts.vault_account.key(),
            valued_vault_token_account: ctx.accounts.valued_vault_token_account.key(),
            escrow_vault_token_account: ctx.accounts.escrow_vault_token_account.key(),
        });
        Ok(())
    }

    pub fn change_escrow_metadata(
        ctx: Context<ChangeEscrowMetadataAccounts>,
        metadata: ChangeEscrowMetadataParams,
    ) -> Result<()> {
        require!(!metadata.value.is_empty(), VestingErrorCode::InvalidMeta);
        let vault_seed = &[
            b"token_vault".as_ref(),
            &ctx.accounts.valued_token_mint.key().to_bytes(),
            &ctx.accounts.escrow_token_mint.key().to_bytes(),
            &[ctx.bumps.vault_account],
        ];
        let vault_signer = &[&vault_seed[..]];

        let field_to_update = match metadata.param_key.as_str() {
            "name" => Field::Name,
            "symbol" => Field::Symbol,
            "uri" => Field::Uri,
            _ => return err!(VestingErrorCode::InvalidMeta),
        };

        token_metadata_update_field(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TokenMetadataUpdateField {
                    token_program_id: ctx.accounts.token_program.to_account_info(),
                    metadata: ctx.accounts.escrow_token_mint.to_account_info(),
                    update_authority: ctx.accounts.vault_account.to_account_info(),
                },
                vault_signer,
            ),
            field_to_update,
            metadata.value.clone(),
        )?;

        // Update the mint account to the minimum balance
        update_account_lamports_to_minimum_balance(
            ctx.accounts.escrow_token_mint.to_account_info(),
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        )?;

        emit!(EscrowMetadataChangedEvent {
            escrow_token_mint: ctx.accounts.escrow_token_mint.key(),
            field_updated: metadata.param_key.clone(),
            value: metadata.value.clone(),
        });
        Ok(())
    }

    /// Exchanges tokens between user and dual auth accounts
    pub fn exchange(ctx: Context<Exchange>, amount: u64) -> Result<()> {
        require!(amount > 0, VestingErrorCode::MinimumAmountHigherZero);
        require!(
            ctx.accounts.user_valued_token_account.amount >= amount,
            VestingErrorCode::InsufficientFunds
        );

        // Transfer tokens from user to vault valued token account
        transfer_tokens(
            &ctx.accounts.user_valued_token_account,
            &ctx.accounts.valued_token_mint,
            &ctx.accounts.valued_vault_token_account,
            &ctx.accounts.valued_token_program,
            amount,
            ctx.accounts.user.to_account_info(),
            None,
        )?;

        // Transfer and/or mint equivalent tokens from escrow vault account to the user token account
        transfer_escrow_from_vault(
            &ctx.accounts.token_program,
            &ctx.accounts.vault_account,
            &ctx.accounts.escrow_vault_token_account,
            &ctx.accounts.user_escrow_token_account,
            &ctx.accounts.valued_token_mint,
            &ctx.accounts.escrow_token_mint,
            ctx.bumps.vault_account,
            amount,
        )?;

        emit!(ExchangedEvent {
            vault_account: ctx.accounts.vault_account.key(),
            amount: amount,
        });

        Ok(())
    }

    /// Creates a new vesting session
    pub fn create_vesting_session(ctx: Context<CreateVestingSession>, amount: u64) -> Result<()> {
        let vesting_account = &mut ctx.accounts.vesting_sessions_account;
        let vesting_session = &mut ctx.accounts.vesting_session_account;

        // Check if the amount is sufficient (at the minimum value)
        require!(
            amount >= MIN_DIVISIBLE_BY_VESTING_PERIOD,
            VestingErrorCode::MinimumAmountNotMet
        );

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
        transfer_tokens(
            &ctx.accounts.user_escrow_token_account,
            &ctx.accounts.escrow_token_mint,
            &ctx.accounts.escrow_vault_token_account,
            &ctx.accounts.token_program,
            amount,
            ctx.accounts.user.to_account_info(),
            None,
        )?;

        emit!(CreatedVestingSessionEvent {
            vault_account: ctx.accounts.vault_account.key(),
            vesting_session: vesting_session.key(),
            user: ctx.accounts.user.key(),
            amount: amount,
        });

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
            let vault_seed = &[
                "token_vault".as_bytes(),
                &ctx.accounts.valued_token_mint.key().to_bytes(),
                &ctx.accounts.escrow_token_mint.key().to_bytes(),
                &[ctx.bumps.vault_account],
            ];
            let vault_signer = &[&vault_seed[..]];

            // Transfer releasable tokens
            transfer_tokens(
                &ctx.accounts.valued_vault_token_account,
                &ctx.accounts.valued_token_mint,
                &ctx.accounts.user_valued_token_account,
                &ctx.accounts.valued_token_program,
                amount_to_release,
                ctx.accounts.vault_account.to_account_info(),
                Some(vault_signer),
            )?;

            // Update vesting session state
            vesting_session.amount_withdrawn = vesting_session
                .amount_withdrawn
                .checked_add(amount_to_release)
                .ok_or(VestingErrorCode::ArithmeticOverflow)?;
            vesting_session.last_withdraw_at = Clock::get()?.unix_timestamp as u64;

            emit!(SessionWithdrawnEvent {
                vault_account: ctx.accounts.vault_account.key(),
                vesting_session: vesting_session.key(),
                user: ctx.accounts.user.key(),
                amount: amount_to_release,
                time: vesting_session.last_withdraw_at,
            });

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
        let escrow_amount_to_get_back = vesting_session
            .amount
            .checked_sub(vesting_session.amount_withdrawn)
            .ok_or(VestingErrorCode::ArithmeticOverflow)?
            .checked_sub(valued_amount_to_release)
            .ok_or(VestingErrorCode::ArithmeticOverflow)?;

        if valued_amount_to_release > 0 {
            // Transfer releasable tokens to user
            let vault_seed = &[
                "token_vault".as_bytes(),
                &ctx.accounts.valued_token_mint.key().to_bytes(),
                &ctx.accounts.escrow_token_mint.key().to_bytes(),
                &[ctx.bumps.vault_account],
            ];
            let vault_signer = &[&vault_seed[..]];

            // Transfer releasable tokens
            transfer_tokens(
                &ctx.accounts.valued_vault_token_account,
                &ctx.accounts.valued_token_mint,
                &ctx.accounts.user_valued_token_account,
                &ctx.accounts.valued_token_program,
                valued_amount_to_release,
                ctx.accounts.vault_account.to_account_info(),
                Some(vault_signer),
            )?;

            // Update vesting session state
            vesting_session.amount_withdrawn = vesting_session
                .amount_withdrawn
                .checked_add(valued_amount_to_release)
                .ok_or(VestingErrorCode::ArithmeticOverflow)?;

            vesting_session.last_withdraw_at = Clock::get()?.unix_timestamp as u64;
        }

        if escrow_amount_to_get_back > 0 {
            // Return remaining tokens to user escrow account
            transfer_escrow_from_vault(
                &ctx.accounts.token_program,
                &ctx.accounts.vault_account,
                &ctx.accounts.escrow_vault_token_account,
                &ctx.accounts.user_escrow_token_account,
                &ctx.accounts.valued_token_mint,
                &ctx.accounts.escrow_token_mint,
                ctx.bumps.vault_account,
                escrow_amount_to_get_back,
            )?;
        }

        // Mark the session as cancelled
        vesting_session.cancelled_at = Clock::get()?.unix_timestamp as u64;

        emit!(SessionCancelEvent {
            vault_account: ctx.accounts.vault_account.key(),
            vesting_session: vesting_session.key(),
            user: ctx.accounts.user.key(),
            valued_amount: valued_amount_to_release,
            escrow_amount: escrow_amount_to_get_back,
            time: vesting_session.cancelled_at,
        });

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
        let amount = vesting_session
            .amount
            .checked_sub(vesting_session.amount_withdrawn)
            .ok_or(VestingErrorCode::ArithmeticOverflow)?;

        if amount > 0 {
            // Transfer releasable tokens to user
            let vault_seed = &[
                "token_vault".as_bytes(),
                &ctx.accounts.valued_token_mint.key().to_bytes(),
                &ctx.accounts.escrow_token_mint.key().to_bytes(),
                &[ctx.bumps.vault_account],
            ];
            let vault_signer = &[&vault_seed[..]];

            // Transfer releasable tokens
            transfer_tokens(
                &ctx.accounts.valued_vault_token_account,
                &ctx.accounts.valued_token_mint,
                &ctx.accounts.user_valued_token_account,
                &ctx.accounts.valued_token_program,
                amount,
                ctx.accounts.vault_account.to_account_info(),
                Some(vault_signer),
            )?;
        }

        // Update vesting session state
        vesting_session.amount_withdrawn = vesting_session
            .amount_withdrawn
            .checked_add(amount)
            .ok_or(VestingErrorCode::ArithmeticOverflow)?;

        vesting_session.last_withdraw_at = Clock::get()?.unix_timestamp as u64;

        // Mark the session as cancelled
        vesting_session.cancelled_at = Clock::get()?.unix_timestamp as u64;

        emit!(SessionExitEvent {
            vault_account: ctx.accounts.vault_account.key(),
            vesting_session: vesting_session.key(),
            user: ctx.accounts.user.key(),
            amount: amount,
            time: vesting_session.cancelled_at,
        });

        Ok(())
    }
}
