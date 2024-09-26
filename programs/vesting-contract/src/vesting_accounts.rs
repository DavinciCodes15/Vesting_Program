use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{ Mint, Token2022, TokenAccount, TokenInterface },
};

/// Parameters for initializing a new token
#[derive(AnchorSerialize, AnchorDeserialize, Debug, Clone)]
pub struct InitEscrowTokenParams {
    pub name: String,
    pub symbol: String,
    pub uri: String,
}

/// Accounts required for initializing a new token
#[derive(Accounts)]
#[instruction(
    params: InitEscrowTokenParams
)]
pub struct InitEscrowToken<'info> {
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
        mint::decimals = valued_token_mint.decimals,
        mint::token_program = token_program,
        mint::authority = backend,
        mint::freeze_authority = backend,
        extensions::metadata_pointer::authority = backend,
        extensions::metadata_pointer::metadata_address = escrow_token_mint
    )]
    pub escrow_token_mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub valued_token_mint: InterfaceAccount<'info, Mint>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token2022>,
}

/// Account structure for vault account
#[account]
#[derive(InitSpace)]
pub struct VaultAccount {
    pub owner: Pubkey, // Public key of the owner
    pub backend: Pubkey, // Public key of the backend authority
    pub valued_token_mint: Pubkey, // Public key of the valued token mint
    pub escrow_token_mint: Pubkey, // public key of the escrow token mint
}

#[derive(Accounts)]
pub struct InitializVaultAccount<'info> {
    /// CHECK: This is not dangerous because we don't read or write from this account
    pub owner: UncheckedAccount<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + VaultAccount::INIT_SPACE,
        seeds = [
            b"token-vault",
            owner.key().as_ref(),
            backend.key().as_ref(),
            valued_token_mint.key().as_ref(),
            escrow_token_mint.key().as_ref(),
        ],
        bump
    )]
    pub vault_account: Box<Account<'info, VaultAccount>>,
    #[account(
        init,
        payer = payer,
        associated_token::mint = valued_token_mint,
        associated_token::authority = vault_account,
        associated_token::token_program = valued_token_program,
        mint::token_program = valued_token_program
    )]
    pub valued_vault_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init,
        payer = payer,
        associated_token::mint = escrow_token_mint,
        associated_token::authority = vault_account,
        associated_token::token_program = token_program,
        mint::token_program = token_program
    )]
    pub escrow_vault_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub payer: Signer<'info>,
    pub backend: Signer<'info>,
    pub valued_token_mint: InterfaceAccount<'info, Mint>,
    pub escrow_token_mint: InterfaceAccount<'info, Mint>,
    pub valued_token_program: Interface<'info, TokenInterface>,
    pub token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Accounts required for minting tokens
#[derive(Accounts)]
#[instruction(
    params: InitEscrowTokenParams
)]
pub struct MintEscrowTokens<'info> {
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
        mint::token_program = token_program       
    )]
    pub escrow_token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        seeds = [
            b"token-vault",
            owner.key().as_ref(),
            backend.key().as_ref(),
            valued_token_mint.key().as_ref(),
            escrow_token_mint.key().as_ref(),
        ],
        bump,
        has_one = owner,
        has_one = backend,
        has_one = escrow_token_mint,
        has_one = valued_token_mint
    )]
    pub vault_account: Account<'info, VaultAccount>,
    #[account(
        mut,
        associated_token::mint = escrow_token_mint,
        associated_token::authority = vault_account,
        associated_token::token_program = token_program,
        mint::token_program = token_program
    )]
    pub escrow_vault_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub valued_token_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Program<'info, Token2022>,
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
            b"token-vault",
            owner.key().as_ref(),
            backend.key().as_ref(),
            valued_token_mint.key().as_ref(),
            escrow_token_mint.key().as_ref(),
        ],
        bump,
        has_one = owner,
        has_one = backend,
        has_one = escrow_token_mint,
        has_one = valued_token_mint
    )]
    pub vault_account: Box<Account<'info, VaultAccount>>,

    #[account(
        mut,
        associated_token::mint = valued_token_mint,
        associated_token::authority = vault_account,
        associated_token::token_program = valued_token_program,
        mint::token_program = valued_token_program
    )]
    pub valued_vault_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        associated_token::mint = escrow_token_mint,
        associated_token::authority = vault_account,
        associated_token::token_program = token_program,
        mint::token_program = token_program
    )]
    pub escrow_vault_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut,
        associated_token::mint = valued_token_mint,
        associated_token::authority = user,
        associated_token::token_program = valued_token_program,
        mint::token_program = valued_token_program
    )]
    pub user_valued_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = escrow_token_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
        mint::token_program = token_program
    )]
    pub user_escrow_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub backend: Signer<'info>,
    pub valued_token_mint: Box<InterfaceAccount<'info, Mint>>,
    pub escrow_token_mint: Box<InterfaceAccount<'info, Mint>>,
    pub valued_token_program: Interface<'info, TokenInterface>,
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
         mut,
         seeds = [
             b"token-vault",
             owner.key().as_ref(),
             backend.key().as_ref(),
             valued_token_mint.key().as_ref(),
             escrow_token_mint.key().as_ref(),
         ],
         bump,
         has_one = owner,
         has_one = backend,
         has_one = escrow_token_mint,
         has_one = valued_token_mint
     )]
    pub vault_account: Box<Account<'info, VaultAccount>>,
    pub backend: Signer<'info>,
    /// Optional authority, which can be the user or omitted for vault/backend transfers
    pub authority: Option<Signer<'info>>,
    #[account(
         mut,
         token::mint = mint,
     )]
    pub from: InterfaceAccount<'info, TokenAccount>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
         mut,
         token::mint = mint,
     )]
    pub to: InterfaceAccount<'info, TokenAccount>,
    pub valued_token_mint: InterfaceAccount<'info, Mint>,
    pub escrow_token_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

/// Account structure for tracking all vesting sessions
#[account]
#[derive(InitSpace)]
pub struct VestingSessionsAccount {
    pub last_session_id: u64, // ID to be used for the next vesting session
    pub user: Pubkey, // Public key of the user
}

/// Account structure for an individual vesting session
#[account]
#[derive(InitSpace)]
pub struct VestingSession {
    pub id: u64, // Unique identifier for this session
    pub user: Pubkey, // Public key of the user
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
            vault_account.key().as_ref(),
            valued_token_mint.key().as_ref(),
            escrow_token_mint.key().as_ref(),
        ],
        bump,
        space = 8 + VestingSessionsAccount::INIT_SPACE
    )]
    pub vesting_sessions_account: Box<Account<'info, VestingSessionsAccount>>,
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
    pub vesting_session_account: Box<Account<'info, VestingSession>>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub backend: Signer<'info>,

    #[account(
        seeds = [
            b"token-vault",
            owner.key().as_ref(),
            backend.key().as_ref(),
            valued_token_mint.key().as_ref(),
            escrow_token_mint.key().as_ref(),
        ],
        bump,
        has_one = owner,
        has_one = backend,
        has_one = escrow_token_mint,
        has_one = valued_token_mint
    )]
    pub vault_account: Box<Account<'info, VaultAccount>>,
    #[account(
        mut,
        associated_token::mint = escrow_token_mint,
        associated_token::authority = vault_account,
        associated_token::token_program = token_program,
        mint::token_program = token_program
    )]
    pub escrow_vault_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut,
        associated_token::mint = escrow_token_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
        mint::token_program = token_program
    )]
    pub user_escrow_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub valued_token_mint: InterfaceAccount<'info, Mint>,
    pub escrow_token_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Accounts required for withdrawing from a vesting session
#[derive(Accounts)]
pub struct SessionWithdraw<'info> {
    /// CHECK: This is not dangerous because we don't read or write from this account
    pub owner: UncheckedAccount<'info>,
    #[account(
        seeds = [
            b"vesting_sessions_account",
            vault_account.key().as_ref(),
            valued_token_mint.key().as_ref(),
            escrow_token_mint.key().as_ref(),
        ],
        bump,
        has_one = user
    )]
    pub vesting_sessions_account: Box<Account<'info, VestingSessionsAccount>>,
    #[account(mut,
        seeds = [
            b"a_vesting_session_account",
            vesting_sessions_account.key().as_ref(),
            vesting_session_account.id.to_le_bytes().as_ref(),
        ],
        bump,
        has_one = user,
        has_one = vesting_sessions_account
    )]
    pub vesting_session_account: Account<'info, VestingSession>,

    #[account(
        seeds = [
            b"token-vault",
            owner.key().as_ref(),
            backend.key().as_ref(),
            valued_token_mint.key().as_ref(),
            escrow_token_mint.key().as_ref(),
        ],
        bump,
        has_one = owner,
        has_one = backend,
        has_one = escrow_token_mint,
        has_one = valued_token_mint
    )]
    pub vault_account: Box<Account<'info, VaultAccount>>,

    #[account(
        mut,
        associated_token::mint = valued_token_mint,
        associated_token::authority = vault_account,
        associated_token::token_program = token_program,
        mint::token_program = token_program
    )]
    pub valued_vault_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub user: Signer<'info>,
    #[account(mut,
        associated_token::mint = valued_token_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
        mint::token_program = token_program
    )]
    pub user_valued_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

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
    #[account(
        seeds = [
            b"vesting_sessions_account",
            vault_account.key().as_ref(),
            valued_token_mint.key().as_ref(),
            escrow_token_mint.key().as_ref(),
        ],
        bump,
        has_one = user
    )]
    pub vesting_sessions_account: Box<Account<'info, VestingSessionsAccount>>,
    #[account(mut,
        seeds = [
            b"a_vesting_session_account",
            vesting_sessions_account.key().as_ref(),
            vesting_session_account.id.to_le_bytes().as_ref(),
        ],
        bump,
        has_one = user,
        has_one = vesting_sessions_account
    )]
    pub vesting_session_account: Box<Account<'info, VestingSession>>,

    #[account(
        seeds = [
            b"token-vault",
            owner.key().as_ref(),
            backend.key().as_ref(),
            valued_token_mint.key().as_ref(),
            escrow_token_mint.key().as_ref(),
        ],
        bump,
        has_one = owner,
        has_one = backend,
        has_one = escrow_token_mint,
        has_one = valued_token_mint
    )]
    pub vault_account: Box<Account<'info, VaultAccount>>,

    #[account(
        mut,
        associated_token::mint = valued_token_mint,
        associated_token::authority = vault_account,
        associated_token::token_program = valued_token_program,
        mint::token_program = valued_token_program
    )]
    pub valued_vault_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = escrow_token_mint,
        associated_token::authority = vault_account,
        associated_token::token_program = token_program,
        mint::token_program = token_program
    )]
    pub escrow_vault_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub user: Signer<'info>,
    #[account(mut,
        associated_token::mint = valued_token_mint,
        associated_token::authority = user,
        associated_token::token_program = valued_token_program,
        mint::token_program = valued_token_program
    )]
    pub user_valued_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut,
        associated_token::mint = escrow_token_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
        mint::token_program = token_program
    )]
    pub user_escrow_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub backend: Signer<'info>,
    pub valued_token_mint: InterfaceAccount<'info, Mint>,
    pub escrow_token_mint: InterfaceAccount<'info, Mint>,
    pub valued_token_program: Interface<'info, TokenInterface>,
    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}
