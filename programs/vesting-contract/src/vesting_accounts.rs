use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{ Mint, Token2022, TokenAccount, TokenInterface },
};

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
    /// CHECK: This is not dangerous because we don't read or write from this account
    pub owner: UncheckedAccount<'info>,
    pub backend: Signer<'info>,

    #[account(
        init,
        seeds = [
            b"mint",
            params.name.as_bytes(),
            valued_token_mint.key().as_ref(),
            owner.key().as_ref(),
            backend.key().as_ref(),
        ],
        bump,
        payer = payer,
        mint::decimals = params.decimals,
        mint::token_program = token_program,
        mint::authority = backend,
        mint::freeze_authority = backend,
        extensions::metadata_pointer::authority = backend,
        extensions::metadata_pointer::metadata_address = mint
    )]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub valued_token_mint: InterfaceAccount<'info, Mint>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token2022>,
}

/// Accounts required for minting tokens
#[derive(Accounts)]
#[instruction(
    params: InitTokenParams
)]
pub struct MintTokens<'info> {
    /// CHECK: This is not dangerous because we don't read or write from this account
    pub owner: UncheckedAccount<'info>,
    pub backend: Signer<'info>,
    #[account(
        mut,
        seeds = [
            b"mint",
            params.name.as_bytes(),
            valued_token_mint.key().as_ref(),
            owner.key().as_ref(),
            backend.key().as_ref(),
        ],
        bump,
        mint::authority = backend,
        mint::token_program = token_program,
    )]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = backend,
        associated_token::token_program = token_program,
        mint::token_program = token_program
    )]
    pub destination: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub valued_token_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Account structure for dual authorization
#[account]
#[derive(InitSpace)]
pub struct DualAuthAccount {
    // pub owner: Pubkey, // Public key of the owner
    pub user: Pubkey, // Public key of the user
    pub backend: Pubkey, // Public key of the backend authority
    // pub valued_token_mint: Pubkey, // Public key of the valued token mint
    // pub escrow_token_mint: Pubkey, // public key of the escrow token mint
}

#[derive(Accounts)]
pub struct InitializeDualAuthAccount<'info> {
    /// CHECK: This is not dangerous because we don't read or write from this account
    pub owner: UncheckedAccount<'info>,
    #[account(
        init,
        payer = user,
        space = 8 + DualAuthAccount::INIT_SPACE,
        seeds = [
            b"dual_auth",
            owner.key().as_ref(),
            user.key().as_ref(),
            backend.key().as_ref(),
            valued_token_mint.key().as_ref(),
            escrow_token_mint.key().as_ref(),
        ],
        bump
    )]
    pub dual_auth_account: Account<'info, DualAuthAccount>,
    #[account(
        init,
        payer = user,
        associated_token::mint = valued_token_mint,
        associated_token::authority = dual_auth_account,
        associated_token::token_program = token_program,
        mint::token_program = token_program
    )]
    pub dual_valued_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub backend: Signer<'info>,
    pub valued_token_mint: InterfaceAccount<'info, Mint>,
    pub escrow_token_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Accounts required for token exchange
#[derive(Accounts)]
#[instruction(amount: u64)]
pub struct Exchange<'info> {
    /// CHECK: This is not dangerous because we don't read or write from this account
    pub owner: UncheckedAccount<'info>,
    #[account(
        seeds = [
            b"dual_auth",
            owner.key().as_ref(),
            user.key().as_ref(),
            backend.key().as_ref(),
            valued_token_mint.key().as_ref(),
            escrow_token_mint.key().as_ref(),
        ],
        has_one = user,
        has_one = backend,
        bump
    )]
    pub dual_auth_account: Box<Account<'info, DualAuthAccount>>,
    #[account(
        mut,
        associated_token::mint = valued_token_mint,
        associated_token::authority = dual_auth_account,
        associated_token::token_program = valued_token_program,
        mint::token_program = valued_token_program
    )]
    pub dual_valued_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub valued_token_program: Interface<'info, TokenInterface>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = escrow_token_mint,
        associated_token::authority = dual_auth_account,
        associated_token::token_program = token_program,
        mint::token_program = token_program
    )]
    pub dual_escrow_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, 
        associated_token::mint = valued_token_mint,
        associated_token::authority = user,
        associated_token::token_program = valued_token_program,
        mint::token_program = valued_token_program
    )]
    pub user_valued_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub backend: Signer<'info>,
    #[account(
        mut,
        associated_token::mint = escrow_token_mint, 
        associated_token::authority = backend,       
        associated_token::token_program = token_program,
        mint::token_program = token_program
    )]
    pub backend_escrow_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub valued_token_mint: Box<InterfaceAccount<'info, Mint>>,
    pub escrow_token_mint: Box<InterfaceAccount<'info, Mint>>,
    pub token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Accounts required for transferring tokens
#[derive(Accounts)]
pub struct TransferTokens<'info> {
    /// CHECK: This is not dangerous because we don't read or write from this account
    pub owner: UncheckedAccount<'info>,
    #[account(
        seeds = [
            b"dual_auth",
            owner.key().as_ref(),
            user.key().as_ref(),
            backend.key().as_ref(),
            valued_token_mint.key().as_ref(),
            escrow_token_mint.key().as_ref(),
        ],
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
    pub from: InterfaceAccount<'info, TokenAccount>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut,
        constraint = to.owner == dual_auth_account.key() || to.owner == dual_auth_account.user.key() || to.owner == dual_auth_account.backend.key()
    )]
    pub to: InterfaceAccount<'info, TokenAccount>,
    pub valued_token_mint: InterfaceAccount<'info, Mint>,
    pub escrow_token_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
}

/// Account structure for tracking all vesting sessions
#[account]
#[derive(InitSpace)]
pub struct VestingSessionsAccount {
    pub last_session_id: u64, // ID to be used for the next vesting session
}

/// Account structure for an individual vesting session
#[account]
#[derive(InitSpace)]
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
    /// CHECK: This is not dangerous because we don't read or write from this account
    pub owner: UncheckedAccount<'info>,
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
        space = 8 + VestingSessionsAccount::INIT_SPACE
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
        space = 8 + VestingSession::INIT_SPACE
    )]
    pub vesting_session_account: Account<'info, VestingSession>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub backend: Signer<'info>,
    pub valued_token_mint: InterfaceAccount<'info, Mint>,
    pub escrow_token_mint: InterfaceAccount<'info, Mint>,
    #[account(
        seeds = [
            b"dual_auth",
            owner.key().as_ref(),
            user.key().as_ref(),
            backend.key().as_ref(),
            valued_token_mint.key().as_ref(),
            escrow_token_mint.key().as_ref(),
        ],
        bump,
        has_one = user,
        has_one = backend
    )]
    pub dual_auth_account: Account<'info, DualAuthAccount>,
    #[account(
        mut,
        associated_token::mint = escrow_token_mint,
        associated_token::authority = backend,
        associated_token::token_program = token_program,
        mint::token_program = token_program
    )]
    pub backend_escrow_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = escrow_token_mint,
        associated_token::authority = dual_auth_account,
        associated_token::token_program = token_program,
        mint::token_program = token_program
    )]
    pub dual_escrow_token_account: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

/// Accounts required for withdrawing from a vesting session
#[derive(Accounts)]
pub struct SessionWithdraw<'info> {
    /// CHECK: This is not dangerous because we don't read or write from this account
    pub owner: UncheckedAccount<'info>,
    #[account(mut)]
    pub vesting_session_account: Account<'info, VestingSession>,

    #[account(
        seeds = [
            b"dual_auth",
            owner.key().as_ref(),
            user.key().as_ref(),
            backend.key().as_ref(),
            valued_token_mint.key().as_ref(),
            escrow_token_mint.key().as_ref(),
        ],
        bump,
        has_one = user,
        has_one = backend
    )]
    pub dual_auth_account: Account<'info, DualAuthAccount>,
    #[account(
        mut,
        associated_token::mint = valued_token_mint,
        associated_token::authority = dual_auth_account,
        associated_token::token_program = token_program,
        mint::token_program = token_program
    )]
    pub dual_valued_token_account: InterfaceAccount<'info, TokenAccount>,

    pub user: Signer<'info>,
    #[account(mut, 
        associated_token::mint = valued_token_mint, 
        associated_token::authority = user,
        associated_token::token_program = token_program,
        mint::token_program = token_program
    )]
    pub user_valued_token_account: InterfaceAccount<'info, TokenAccount>,

    pub backend: Signer<'info>,
    pub valued_token_mint: InterfaceAccount<'info, Mint>,
    pub escrow_token_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

/// Accounts required for cancelling a vesting session
#[derive(Accounts)]
pub struct SessionCancelation<'info> {
    /// CHECK: This is not dangerous because we don't read or write from this account
    pub owner: UncheckedAccount<'info>,
    #[account(mut)]
    pub vesting_session_account: Account<'info, VestingSession>,

    #[account(
        seeds = [
            b"dual_auth",
            owner.key().as_ref(),
            user.key().as_ref(),
            backend.key().as_ref(),
            valued_token_mint.key().as_ref(),
            escrow_token_mint.key().as_ref(),
        ],
        bump,
        has_one = user,
        has_one = backend
    )]
    pub dual_auth_account: Account<'info, DualAuthAccount>,
    #[account(
        mut,
        associated_token::mint = valued_token_mint,
        associated_token::authority = dual_auth_account,
        associated_token::token_program = valued_token_program,
        mint::token_program = valued_token_program
    )]
    pub dual_valued_token_account: InterfaceAccount<'info, TokenAccount>,

    pub valued_token_program: Interface<'info, TokenInterface>,

    #[account(
        mut,
        associated_token::mint = escrow_token_mint,
        associated_token::authority = dual_auth_account,
        associated_token::token_program = token_program,
        mint::token_program = token_program
    )]
    pub dual_escrow_token_account: InterfaceAccount<'info, TokenAccount>,

    pub user: Signer<'info>,
    #[account(mut, 
        associated_token::mint = valued_token_mint, 
        associated_token::authority = user,
        associated_token::token_program = valued_token_program,
        mint::token_program = valued_token_program
    )]
    pub user_valued_token_account: InterfaceAccount<'info, TokenAccount>,

    pub backend: Signer<'info>,
    #[account(
        mut,
        associated_token::mint = escrow_token_mint,
        associated_token::authority = backend,
        associated_token::token_program = token_program,
        mint::token_program = token_program
    )]
    pub backend_escrow_token_account: InterfaceAccount<'info, TokenAccount>,

    pub valued_token_mint: InterfaceAccount<'info, Mint>,
    pub escrow_token_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}
