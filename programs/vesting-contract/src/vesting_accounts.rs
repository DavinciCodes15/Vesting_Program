use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    metadata::Metadata as Metaplex,
    token::{ Mint, Token, TokenAccount },
};
use std::mem::size_of;

/// Parameters for initializing a new token
#[derive(AnchorSerialize, AnchorDeserialize, Debug, Clone)]
pub struct InitTokenParams {
    pub name: String,
    pub symbol: String,
    pub uri: String,
    pub decimals: u8,
}

/// Accounts required for initializing a new token
#[derive(Accounts)]
#[instruction(
    params: InitTokenParams
)]
pub struct InitToken<'info> {
    /// CHECK: New Metaplex Account being created
    #[account(mut)]
    pub metadata: UncheckedAccount<'info>,
    #[account(
        init,
        seeds = [b"mint", params.name.as_bytes(), payer.key().as_ref()],
        bump,
        payer = payer,
        mint::decimals = params.decimals,
        mint::authority = mint
    )]
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub token_metadata_program: Program<'info, Metaplex>,
}

/// Accounts required for minting tokens
#[derive(Accounts)]
#[instruction(
    params: InitTokenParams
)]
pub struct MintTokens<'info> {
    #[account(
        mut,
        seeds = [b"mint",params.name.as_bytes(),payer.key().as_ref()],
        bump,
        mint::authority = mint,
    )]
    pub mint: Account<'info, Mint>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = payer
    )]
    pub destination: Account<'info, TokenAccount>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

/// Account structure for dual authorization
#[account]
pub struct DualAuthAccount {
    pub user: Pubkey, // Public key of the user
    pub backend: Pubkey, // Public key of the backend authority
    // pub valued_token_account: Pubkey, // Account holding the primary token
    //pub escrow_token_account: Pubkey, // Account holding tokens in escrow
}

/// Accounts required for token exchange
#[derive(Accounts)]
#[instruction(amount: u64)]
pub struct Exchange<'info> {
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + size_of::<DualAuthAccount>(),
        seeds = [b"dual_auth", user.key().as_ref(), backend.key().as_ref()],
        bump
    )]
    pub dual_auth_account: Box<Account<'info, DualAuthAccount>>,
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = valued_token_mint,
        associated_token::authority = dual_auth_account
    )]
    pub dual_valued_token_account: Box<Account<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = escrow_token_mint,
        associated_token::authority = dual_auth_account
    )]
    pub dual_escrow_token_account: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, associated_token::mint = valued_token_mint, associated_token::authority = user)]
    pub user_valued_token_account: Box<Account<'info, TokenAccount>>,

    pub backend: Signer<'info>,
    #[account(mut, associated_token::mint = escrow_token_mint, associated_token::authority = backend)]
    pub backend_escrow_token_account: Box<Account<'info, TokenAccount>>,

    pub valued_token_mint: Box<Account<'info, Mint>>,
    pub escrow_token_mint: Box<Account<'info, Mint>>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Accounts required for transferring tokens
#[derive(Accounts)]
pub struct TransferTokens<'info> {
    #[account(
        seeds = [b"dual_auth", user.key().as_ref(), backend.key().as_ref()],
        bump,
        has_one = user,
        has_one = backend
    )]
    pub dual_auth_account: Account<'info, DualAuthAccount>,
    pub user: Signer<'info>,
    pub backend: Signer<'info>,
    #[account(
        mut,        
        constraint = from.owner == dual_auth_account.key() || from.owner == dual_auth_account.user.key() || from.owner == dual_auth_account.backend.key()
    )]
    pub from: Account<'info, TokenAccount>,
    #[account(mut,
        constraint = to.owner == dual_auth_account.key() || to.owner == dual_auth_account.user.key() || to.owner == dual_auth_account.backend.key()
    )]
    pub to: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

/// Account structure for tracking all vesting sessions
#[account]
pub struct VestingSessionsAccount {
    pub last_session_id: u64, // ID to be used for the next vesting session
}

/// Account structure for an individual vesting session
#[account]
pub struct VestingSession {
    pub id: u64, // Unique identifier for this session
    pub vesting_sessions_account: Pubkey, // Parent account tracking all sessions
    pub amount: u64, // Total amount of tokens in this vesting session
    pub amount_withdrawn: u64, // Amount of tokens already withdrawn
    pub start_date: u64, // Start date of the vesting session
    pub last_withdraw_at: u64, // Timestamp of the last withdrawal
    pub cancelled_at: u64, // Timestamp when the session was cancelled (0 if not cancelled)
}

/// Accounts required for creating a vesting session
#[derive(Accounts)]
pub struct CreateVestingSession<'info> {
    #[account(
        init_if_needed,
        payer = user,
        seeds = [
            b"vesting_sessions_account",
            dual_auth_account.key().as_ref(),
            valued_token_mint.key().as_ref(),
            escrow_token_mint.key().as_ref(),
        ],
        bump,
        space = 8 + size_of::<VestingSessionsAccount>()
    )]
    pub vesting_sessions_account: Account<'info, VestingSessionsAccount>,
    #[account(
        init,
        payer = user,
        seeds = [
            b"a_vesting_session_account",
            vesting_sessions_account.key().as_ref(),
            vesting_sessions_account.last_session_id.to_le_bytes().as_ref(),
        ],
        bump,
        space = 8 + size_of::<VestingSession>()
    )]
    pub vesting_session_account: Account<'info, VestingSession>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub backend: Signer<'info>,
    pub valued_token_mint: Account<'info, Mint>,
    pub escrow_token_mint: Account<'info, Mint>,
    #[account(
        seeds = [b"dual_auth", user.key().as_ref(), backend.key().as_ref()],
        bump,
        has_one = user,
        has_one = backend
    )]
    pub dual_auth_account: Account<'info, DualAuthAccount>,
    #[account(
        mut,
        associated_token::mint = escrow_token_mint,
        associated_token::authority = backend
    )]
    pub backend_escrow_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = escrow_token_mint,
        associated_token::authority = dual_auth_account
    )]
    pub dual_escrow_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

/// Accounts required for withdrawing from a vesting session
#[derive(Accounts)]
pub struct SessionWithdraw<'info> {
    #[account(mut)]
    pub vesting_session_account: Account<'info, VestingSession>,

    #[account(
        seeds = [b"dual_auth", user.key().as_ref(), backend.key().as_ref()],
        bump,
        has_one = user,
        has_one = backend
    )]
    pub dual_auth_account: Account<'info, DualAuthAccount>,
    #[account(
        mut,
        associated_token::mint = valued_token_mint,
        associated_token::authority = dual_auth_account
    )]
    pub dual_valued_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, associated_token::mint = valued_token_mint, associated_token::authority = user)]
    pub user_valued_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub backend: Signer<'info>,
    pub valued_token_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

/// Accounts required for cancelling a vesting session
#[derive(Accounts)]
pub struct SessionCancelation<'info> {
    #[account(mut)]
    pub vesting_session_account: Account<'info, VestingSession>,

    #[account(
        seeds = [b"dual_auth", user.key().as_ref(), backend.key().as_ref()],
        bump,
        has_one = user,
        has_one = backend
    )]
    pub dual_auth_account: Account<'info, DualAuthAccount>,
    #[account(
        mut,
        associated_token::mint = valued_token_mint,
        associated_token::authority = dual_auth_account
    )]
    pub dual_valued_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = escrow_token_mint,
        associated_token::authority = dual_auth_account
    )]
    pub dual_escrow_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, associated_token::mint = valued_token_mint, associated_token::authority = user)]
    pub user_valued_token_account: Account<'info, TokenAccount>,

    pub backend: Signer<'info>,
    #[account(mut)]
    pub backend_escrow_token_account: Account<'info, TokenAccount>,

    pub valued_token_mint: Account<'info, Mint>,
    pub escrow_token_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}
