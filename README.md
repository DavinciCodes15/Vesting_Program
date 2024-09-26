# Solana Vesting Contract Documentation

## Overview

This Solana Anchor contract implements a token vesting system with dual-token functionality. It allows users to exchange one token type for another, create vesting schedules, and manage the vesting process. The contract supports initialization of new tokens, vault accounts, and vesting sessions, as well as operations like token exchange, withdrawals, and session cancellations.

## Key Components

1. **Token Mints**
   - Valued Token: The primary token used in the system.
   - Escrow Token: A secondary token created and managed by the contract.

2. **Accounts**
   - Vault Account: Stores information about the token vault.
   - Vesting Sessions Account: Tracks all vesting sessions.
   - Vesting Session Account: Represents an individual vesting session.

3. **Key Roles**
   - User: The account participating in vesting.
   - Backend: An authority account with special permissions.
   - Owner: Another authority account (often the same as the backend).

## Contract Structure

The contract is split into several files:

- `lib.rs`: Main contract logic and instruction handlers.
- `errors.rs`: Custom error definitions.
- `helpers.rs`: Utility functions for common operations.
- `vesting_accounts.rs`: Account structures and constraints.

## Functionality

### 1. Token Initialization

- **Function:** `init_escrow_token`
- **Purpose:** Initializes a new escrow token with metadata.
- **Key Actions:**
  - Creates a Program Derived Address (PDA) for the token mint.
  - Initializes token metadata.

### 2. Vault Account Initialization

- **Function:** `initialize_vault_account`
- **Purpose:** Sets up a new vault account to manage tokens.
- **Key Actions:**
  - Initializes the vault account with owner and token information.

### 3. Escrow Token Minting

- **Function:** `mint_escrow_tokens`
- **Purpose:** Mints new escrow tokens into the vault account.
- **Key Actions:**
  - Mints tokens to the escrow vault token account.

### 4. Token Exchange

- **Function:** `exchange`
- **Purpose:** Allows users to exchange valued tokens for escrow tokens.
- **Key Actions:**
  - Transfers valued tokens from user to vault.
  - Transfers equivalent escrow tokens from vault to user.

### 5. Vesting Session Creation

- **Function:** `create_vesting_session`
- **Purpose:** Initiates a new vesting schedule for a user.
- **Key Actions:**
  - Creates a new vesting session account.
  - Transfers escrow tokens from user to vault.

### 6. Vesting Withdrawal

- **Function:** `session_withdraw`
- **Purpose:** Allows users to withdraw vested tokens.
- **Key Actions:**
  - Calculates the amount of tokens available for withdrawal.
  - Transfers vested tokens from vault to user.
  - Updates the vesting session state.

### 7. Vesting Session Cancellation

- **Function:** `session_cancel`
- **Purpose:** Cancels an ongoing vesting session.
- **Key Actions:**
  - Calculates vested and unvested amounts.
  - Transfers vested tokens to user.
  - Returns unvested escrow tokens to the user.
  - Marks the session as cancelled.

### 8. Vesting Session Exit

- **Function:** `session_exit`
- **Purpose:** Allows a user to exit a vesting session and claim all remaining tokens, as failsafe.
- **Key Actions:**
  - Transfers all remaining tokens to the user.
  - Marks the session as cancelled.

## Security Features

1. **PDA Usage:** Utilizes Program Derived Addresses for secure account derivation.
2. **Authority Checks:** Implements checks to ensure only authorized accounts can perform sensitive operations.
3. **Arithmetic Overflow Protection:** Uses checked arithmetic operations to prevent overflows.

## Testing

The contract includes comprehensive tests in `vesting-contract.ts`, covering:
- Token initialization and minting
- Vault account creation
- Token exchange
- Vesting session creation, withdrawal, cancellation, and exit
- Security scenarios (e.g., rapid withdrawals, incorrect authority)