use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, Token2022, TokenAccount, TokenInterface},
};
use anchor_lang::solana_program::bpf_loader_upgradeable as bpf;

// ##### set_backend_account #####

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SetBackendAccountParams {
    pub new_backend_account: Pubkey,
    pub new_authority: Option<Pubkey>,
}

#[account]
#[derive(InitSpace)]
pub struct BackendAccountData {
    pub backend_account: Pubkey,
    pub change_authority: Option<Pubkey>,
}

#[derive(Accounts)]
#[instruction(params: SetBackendAccountParams)]
pub struct SetBackendAccountCtx<'info> {
    pub system_program: Program<'info, System>,
    #[account(
        mut,
        seeds = [crate::ID.as_ref()],
        bump,
        seeds::program = bpf::id(),
    )]
    pub program_data: Account<'info, ProgramData>,
    #[account(
        init_if_needed,
        seeds = [
            b"davincij15_seed"
        ],
        bump,
        payer = payer,
        space = 8 + BackendAccountData::INIT_SPACE
    )]
    pub backend_data: Box<Account<'info, BackendAccountData>>,
    #[account(mut)]
    pub payer: Signer<'info>,
}

// ##### init_escrow_token #####

/// Parameters for initializing a new token
#[derive(AnchorSerialize, AnchorDeserialize, Debug, Clone)]
pub struct InitEscrowTokenParams {
    pub name: String,
    pub symbol: String,
    pub uri: String,
    pub app_id: String,
}

/// Account structure for vault account
#[account]
#[derive(InitSpace)]
pub struct VaultAccount {
    pub creator: Pubkey, // Public key of the account that requested the creation of the token
    pub valued_token_mint: Pubkey, // Public key of the valued token mint
    pub escrow_token_mint: Pubkey, // public key of the escrow token mint
    #[max_len(100)]
    pub app_id: String, //Unique id of the app used to create the escrow
}

/// Accounts required for initializing a new token
#[derive(Accounts)]
#[instruction(
    params: InitEscrowTokenParams
)]
pub struct InitEscrowToken<'info> {
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token2022>,
    pub valued_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,

    // Backend authorization
    #[account(
        seeds = [
            b"davincij15_seed"
        ],
        bump        
    )]
    pub backend_data: Box<Account<'info, BackendAccountData>>,
    #[account(address = backend_data.backend_account)]
    pub backend: Signer<'info>,

    //New vault for new token creation
    #[account(
        init,
        payer = payer,
        space = 8 + VaultAccount::INIT_SPACE,
        seeds = [
            b"token_vault",
            valued_token_mint.key().as_ref(),
            escrow_token_mint.key().as_ref(),
        ],
        bump
    )]
    pub vault_account: Box<Account<'info, VaultAccount>>,

    pub valued_token_mint: Box<InterfaceAccount<'info, Mint>>,
    // New mint address creation
    #[account(
        init,
        seeds = [
            b"escrow_mint",
            valued_token_mint.key().as_ref(),
            params.app_id.as_bytes(),
        ],
        bump,
        payer = payer,
        mint::decimals = valued_token_mint.decimals,
        mint::token_program = token_program,
        mint::authority = vault_account,
        mint::freeze_authority = vault_account,
        extensions::metadata_pointer::authority = vault_account,
        extensions::metadata_pointer::metadata_address = escrow_token_mint
    )]
    pub escrow_token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut)]
    pub payer: Signer<'info>,
}

#[derive(Accounts)]
pub struct InitVaultTokenAccounts<'info> {
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token2022>,
    pub valued_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub valued_token_mint: Box<InterfaceAccount<'info, Mint>>,
    pub escrow_token_mint: Box<InterfaceAccount<'info, Mint>>,

    // Backend authorization
    #[account(
        seeds = [
            b"davincij15_seed"
        ],
        bump        
    )]
    pub backend_data: Box<Account<'info, BackendAccountData>>,
    #[account(address = backend_data.backend_account)]
    pub backend: Signer<'info>,

    #[account(
        seeds = [
            b"token_vault",
            valued_token_mint.key().as_ref(),
            escrow_token_mint.key().as_ref(),
        ],
        bump,
        has_one = escrow_token_mint,
        has_one = valued_token_mint
    )]
    pub vault_account: Box<Account<'info, VaultAccount>>,

    // Creation of new token accounts for valued an escrow
    #[account(
        init,
        payer = payer,        
        associated_token::mint = valued_token_mint,
        associated_token::authority = vault_account,
        associated_token::token_program = valued_token_program,
        mint::token_program = valued_token_program,        
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
}

/// Parameters for initializing a new token
#[derive(AnchorSerialize, AnchorDeserialize, Debug, Clone)]
pub struct ChangeEscrowMetadataParams {
    pub value: String,
    pub param_key: String,
}

/// Update token metadata
#[derive(Accounts)]
#[instruction(
    params: ChangeEscrowMetadataParams
)]
pub struct ChangeEscrowMetadataAccounts<'info> {
    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
    pub valued_token_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub escrow_token_mint: Box<InterfaceAccount<'info, Mint>>,

    //Backend authorization
    #[account(
        seeds = [
            b"davincij15_seed"
        ],
        bump
    )]
    pub backend_data: Box<Account<'info, BackendAccountData>>,
    #[account(address = backend_data.backend_account)]
    pub backend: Signer<'info>,

    #[account(
        mut,
        seeds = [
            b"token_vault",
            valued_token_mint.key().as_ref(),
            escrow_token_mint.key().as_ref(),
        ],
        bump,
        has_one = escrow_token_mint,
        has_one = valued_token_mint
    )]
    pub vault_account: Box<Account<'info, VaultAccount>>,
    #[account(mut)]
    pub payer: Signer<'info>,
}


/// Accounts required for token exchange
#[derive(Accounts)]
#[instruction(amount: u64)]
pub struct Exchange<'info> {
    pub token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub valued_token_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub escrow_token_mint: Box<InterfaceAccount<'info, Mint>>,
    pub valued_token_program: Interface<'info, TokenInterface>,

    //Backend authorization
    #[account(
        seeds = [
            b"davincij15_seed"
        ],
        bump
    )]
    pub backend_data: Box<Account<'info, BackendAccountData>>,
    #[account(address = backend_data.backend_account)]
    pub backend: Signer<'info>,

    #[account(
        mut,
        seeds = [
            b"token_vault",
            valued_token_mint.key().as_ref(),
            escrow_token_mint.key().as_ref(),
        ],
        bump,
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

    // User token accounts
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
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
}

/// Account structure for tracking all vesting sessions
#[account]
#[derive(InitSpace)]
pub struct VestingSessionsAccount {
    pub last_session_id: u64, // ID to be used for the next vesting session
    pub user: Pubkey,         // Public key of the user
}

/// Account structure for an individual vesting session
#[account]
#[derive(InitSpace)]
pub struct VestingSession {
    pub id: u64,                          // Unique identifier for this session
    pub user: Pubkey,                     // Public key of the user
    pub vesting_sessions_account: Pubkey, // Parent account tracking all sessions
    pub amount: u64,                      // Total amount of tokens in this vesting session
    pub amount_withdrawn: u64,            // Amount of tokens already withdrawn
    pub start_date: u64,                  // Start date of the vesting session
    pub last_withdraw_at: u64,            // Timestamp of the last withdrawal
    pub cancelled_at: u64, // Timestamp when the session was cancelled (0 if not cancelled)
}

/// Accounts required for creating a vesting session
#[derive(Accounts)]
pub struct CreateVestingSession<'info> {
    pub valued_token_mint: InterfaceAccount<'info, Mint>,
    pub escrow_token_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,

    //Backend authorization
    #[account(
        seeds = [
            b"davincij15_seed"
        ],
        bump
    )]
    pub backend_data: Box<Account<'info, BackendAccountData>>,
    #[account(address = backend_data.backend_account)]
    pub backend: Signer<'info>,

    #[account(
        init_if_needed,
        payer = user,
        seeds = [
            b"user_vesting_session_collection",
            vault_account.key().as_ref(),
            user.key().as_ref(),
        ],
        bump,
        space = 8 + VestingSessionsAccount::INIT_SPACE
    )]
    pub vesting_sessions_account: Box<Account<'info, VestingSessionsAccount>>,

    #[account(
        init,
        payer = user,
        seeds = [
            b"user_vesting_session",
            vesting_sessions_account.key().as_ref(),
            vesting_sessions_account.last_session_id.to_le_bytes().as_ref(),
        ],
        bump,
        space = 8 + VestingSession::INIT_SPACE
    )]
    pub vesting_session_account: Box<Account<'info, VestingSession>>,

    #[account(
        seeds = [
            b"token_vault",
            valued_token_mint.key().as_ref(),
            escrow_token_mint.key().as_ref(),
        ],
        bump,
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

    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut,
        associated_token::mint = escrow_token_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
        mint::token_program = token_program
    )]
    pub user_escrow_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
}

/// Accounts required for withdrawing from a vesting session
#[derive(Accounts)]
pub struct SessionWithdraw<'info> {
    #[account(mut)]
    pub valued_token_mint: InterfaceAccount<'info, Mint>,
    pub escrow_token_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Program<'info, Token2022>,
    pub valued_token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,

    //Backend authorization
    #[account(
        seeds = [
            b"davincij15_seed"
        ],
        bump
    )]
    pub backend_data: Box<Account<'info, BackendAccountData>>,
    #[account(address = backend_data.backend_account)]
    pub backend: Signer<'info>,

    #[account(
        seeds = [
            b"user_vesting_session_collection",
            vault_account.key().as_ref(),
            user.key().as_ref(),
        ],
        bump,
        has_one = user
    )]
    pub vesting_sessions_account: Box<Account<'info, VestingSessionsAccount>>,

    #[account(mut,
        has_one = user,
        has_one = vesting_sessions_account
    )]
    pub vesting_session_account: Account<'info, VestingSession>,

    #[account(
        seeds = [
            b"token_vault",
            valued_token_mint.key().as_ref(),
            escrow_token_mint.key().as_ref(),
        ],
        bump,
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

    pub user: Signer<'info>,
    #[account(mut,
        associated_token::mint = valued_token_mint,
        associated_token::authority = user,
        associated_token::token_program = valued_token_program,
        mint::token_program = valued_token_program
    )]
    pub user_valued_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
}

/// Accounts required for cancelling a vesting session
#[derive(Accounts)]
pub struct SessionCancelation<'info> {
    pub valued_token_mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub escrow_token_mint: InterfaceAccount<'info, Mint>,
    pub valued_token_program: Interface<'info, TokenInterface>,
    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,

    //Backend authorization
    #[account(
        seeds = [
            b"davincij15_seed"
        ],
        bump
    )]
    pub backend_data: Box<Account<'info, BackendAccountData>>,
    #[account(address = backend_data.backend_account)]
    pub backend: Signer<'info>,

    #[account(
        seeds = [
            b"user_vesting_session_collection",
            vault_account.key().as_ref(),
            user.key().as_ref(),
        ],
        bump,
        has_one = user
    )]
    pub vesting_sessions_account: Box<Account<'info, VestingSessionsAccount>>,
    #[account(mut,
        has_one = user,
        has_one = vesting_sessions_account
    )]
    pub vesting_session_account: Account<'info, VestingSession>,

    #[account(
        mut,
        seeds = [
            b"token_vault",
            valued_token_mint.key().as_ref(),
            escrow_token_mint.key().as_ref(),
        ],
        bump,
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
}
