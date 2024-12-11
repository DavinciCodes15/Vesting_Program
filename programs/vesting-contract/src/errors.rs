use anchor_lang::{error_code, prelude::ProgramError};

/// Custom error codes for the contract
#[error_code]
pub enum VestingErrorCode {
    #[msg("Insufficient funds")]
    InsufficientFunds,
    #[msg("Not Enough token was released to withdraw")]
    InsufficientWithdrawalAmount,
    #[msg("Amount can not be zero")]
    MinimumAmountHigherZero,
    #[msg("Minimum amount not met")]
    MinimumAmountNotMet,
    #[msg("Arithmetic overflow occurred")]
    ArithmeticOverflow,
    #[msg("Division by zero attempted")]
    DivisionByZero,
    #[msg("Interacting with canceled session")]
    InteractingWithCanceledSession,
    #[msg("Unathorized to execute this operation")]
    UnathorizedToExecute,
    #[msg("Invalid metadata received")]
    InvalidMeta,
    #[msg("Received valued token implements a token extension not supported by the vesting app")]
    UnsupportedTokenExtension,
}

// Implementation to convert ErrorCode to ProgramError
impl From<VestingErrorCode> for ProgramError {
    fn from(e: VestingErrorCode) -> ProgramError {
        ProgramError::Custom(e as u32)
    }
}
