/// Helper functions for the contract

use anchor_lang::prelude::*;
use anchor_spl::token::{ self, Transfer };
use crate::{VestingErrorCode, VestingSession};

/// Helper function to transfer tokens
pub fn transfer_tokens_helper<'info>(
    from: &Account<'info, token::TokenAccount>,
    to: &Account<'info, token::TokenAccount>,
    authority: AccountInfo<'info>,
    user: &Signer<'info>,
    backend: &Signer<'info>,
    token_program: &Program<'info, token::Token>,
    amount: u64,
    bump: u8
) -> Result<()> {
    // Create seeds for PDA signing
    let seeds = &[b"dual_auth", user.key.as_ref(), backend.key.as_ref(), &[bump]];
    let signer = &[&seeds[..]];

    // Set up the accounts for the transfer
    let cpi_accounts = Transfer {
        from: from.to_account_info(),
        to: to.to_account_info(),
        authority: authority.to_account_info(),
    };
    let cpi_program = token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);

    // Execute the transfer
    token::transfer(cpi_ctx, amount)?;

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
            vesting_session.last_withdraw_at.checked_div(60).ok_or(VestingErrorCode::DivisionByZero)?
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
