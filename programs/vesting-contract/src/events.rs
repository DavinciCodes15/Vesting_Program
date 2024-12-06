use anchor_lang::prelude::*;

#[event]
pub struct EscrowCreatedEvent {
    pub creator: Pubkey,
    pub valued_token_mint: Pubkey,
    pub escrow_token_mint: Pubkey,
    pub vault_account: Pubkey,
    pub app_id: String,
}

#[event]
pub struct VaultAccountInitializedEvent {
    pub vault_account: Pubkey,
    pub valued_vault_token_account: Pubkey,
    pub escrow_vault_token_account: Pubkey,
}

#[event]
pub struct EscrowMetadataChangedEvent {
    pub escrow_token_mint: Pubkey,
    pub field_updated: String,
    pub value: String,
}

#[event]
pub struct ExchangedEvent {
    pub vault_account: Pubkey,
    pub amount: u64,
}

#[event]
pub struct CreatedVestingSessionEvent {
    pub vault_account: Pubkey,
    pub vesting_session: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
}

#[event]
pub struct SessionWithdrawnEvent {
    pub vault_account: Pubkey,
    pub vesting_session: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub time: u64,
}

#[event]
pub struct SessionCancelEvent {
    pub vault_account: Pubkey,
    pub vesting_session: Pubkey,
    pub user: Pubkey,
    pub valued_amount: u64,
    pub escrow_amount: u64,
    pub time: u64,
}

#[event]
pub struct SessionExitEvent {
    pub vault_account: Pubkey,
    pub vesting_session: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub time: u64,
}
