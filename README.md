# Vesting Contract Documentation

## Overview

This Solana program implements a token vesting contract with dual authorization features. It allows for the creation, management, and execution of token vesting schedules, as well as token minting and transfers. The contract is designed to work with the Solana blockchain and utilizes the Anchor framework.

## Key Components

### Accounts

1. **DualAuthAccount**: Manages dual authorization between a user and a backend.
2. **VestingSessionsAccount**: Tracks all vesting sessions.
3. **VestingSession**: Represents an individual vesting session.

### Instructions

1. `init_token`: Initializes a new token with metadata.
2. `mint_tokens`: Mints new tokens to a specified account.
3. `initialize_dual_auth_account`: Creates a new dual authorization account.
4. `exchange`: Exchanges tokens between user and dual auth accounts.
5. `transfer_tokens`: Transfers tokens between accounts under dual authorization.
6. `create_vesting_session`: Creates a new vesting session.
7. `session_withdraw`: Withdraws vested tokens from a session.
8. `session_cancel`: Cancels an ongoing vesting session.

## Detailed Instruction Documentation

### 1. init_token

Initializes a new token with metadata.

**Parameters:**
- `metadata: InitTokenParams`: Contains token metadata (name, symbol, URI, decimals).

### 2. mint_tokens

Mints new tokens to a specified account.

**Parameters:**
- `metadata: InitTokenParams`: Token metadata.
- `quantity: u64`: Amount of tokens to mint.

### 3. initialize_dual_auth_account

Initializes a new dual authorization account.

### 4. exchange

Exchanges tokens between user and dual auth accounts.

**Parameters:**
- `amount: u64`: Amount of tokens to exchange.

### 5. transfer_tokens

Transfers tokens between accounts under dual authorization.

**Parameters:**
- `amount: u64`: Amount of tokens to transfer.

### 6. create_vesting_session

Creates a new vesting session.

**Parameters:**
- `amount: u64`: Amount of tokens to vest.

### 7. session_withdraw

Withdraws vested tokens from a session.

### 8. session_cancel

Cancels an ongoing vesting session.

## Error Handling

The contract defines custom error codes in the `VestingErrorCode` enum:

- `InsufficientFunds`: When there are not enough funds for an operation.
- `InsufficientWithdrawalAmount`: When the amount to withdraw is less than the vested amount.
- `MinimumAmountNotMet`: When the specified amount is less than the minimum required.
- `ArithmeticOverflow`: When an arithmetic operation results in an overflow.
- `DivisionByZero`: When a division by zero is attempted.

## Security Considerations

1. The contract uses PDAs (Program Derived Addresses) for secure key derivation.
2. Dual authorization is implemented to enhance security for critical operations.
3. Checked math operations are used to prevent overflow/underflow vulnerabilities.

## Conclusion

This vesting contract provides a robust foundation for managing token vesting on the Solana blockchain. It offers flexibility through its dual authorization system and provides essential functionality for creating, managing, and executing vesting schedules. As with any financial smart contract, thorough testing and auditing are recommended before deployment to a production environment.