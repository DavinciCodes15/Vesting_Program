# Vesting Contract Documentation

## Table of Contents

1. [Introduction](#introduction)
2. [Contract Overview](#contract-overview)
3. [Key Components](#key-components)
4. [Security Features](#security-features)
5. [Contract Functions](#contract-functions)
6. [Account Structures](#account-structures)
7. [Testing](#testing)

## 1. Introduction

This document provides comprehensive documentation for the Vesting Contract, a Solana-based smart contract implemented using the Anchor framework. The contract facilitates a token vesting system with dual authorization, allowing for secure and controlled token distribution over time.

## 2. Contract Overview

The Vesting Contract implements a token vesting mechanism with the following key features:

- Token initialization and minting
- Dual authorization for enhanced security
- Token exchange between user and dual auth accounts
- Creation and management of vesting sessions
- Controlled token withdrawal from vesting sessions
- Ability to cancel vesting sessions

## 3. Key Components

### 3.1 Dual Authorization

The contract uses a dual authorization system requiring signatures from both the user and a backend authority for critical operations. This enhances security and prevents unauthorized actions.

### 3.2 Vesting Sessions

Vesting sessions allow for controlled release of tokens over time. Each session has its own parameters including start date, total amount, and withdrawal history.

### 3.3 Token Management

The contract handles two types of tokens:
- Valued Tokens: The primary tokens being vested
- Escrow Tokens: Tokens held in escrow as part of the vesting process

## 4. Security Features

- Program Derived Addresses (PDAs) for secure account derivation
- Constraint checks to validate account relationships and permissions
- Custom error codes for precise error handling
- Time-based vesting logic to ensure proper token release schedules

## 5. Contract Functions

### 5.1 `init_token`

Initializes a new token with metadata.

### 5.2 `mint_tokens`

Mints new tokens to a specified account.

### 5.3 `exchange`

Exchanges tokens between user and dual auth accounts.

### 5.4 `transfer_tokens`

Transfers tokens between accounts under dual authorization.

### 5.5 `create_vesting_session`

Creates a new vesting session with specified parameters.

### 5.6 `session_withdraw`

Withdraws vested tokens from a session based on the current time and vesting schedule.

### 5.7 `session_cancel`

Cancels an ongoing vesting session and handles the distribution of vested and unvested tokens.

## 6. Account Structures

### 6.1 `DualAuthAccount`

Stores information about the dual authorization setup, including user and backend public keys.

### 6.2 `VestingSessionsAccount`

Tracks all vesting sessions, maintaining a counter for session IDs.

### 6.3 `VestingSession`

Represents an individual vesting session, storing details such as amount, start date, and withdrawal history.

## 7. Testing

The contract includes a comprehensive test suite covering various scenarios:

- Token exchange and account initialization
- Token transfers
- Vesting session creation, withdrawal, and cancellation
- Security tests for incorrect authority attempts



## Conclusion

This Vesting Contract provides a secure and flexible system for token vesting on the Solana blockchain. By leveraging dual authorization and time-based vesting logic, it offers a robust solution for controlled token distribution.