use anchor_lang::{ error_code, prelude::ProgramError };

/// Custom error codes for the contract
#[error_code]
pub enum VestingErrorCode {
    #[msg("Insufficient funds.")]
    InsufficientFunds,
    #[msg("Not Enough token was released to withdraw.")]
    InsufficientWithdrawalAmount,
    #[msg("Minimum amount not met.")]
    MinimumAmountNotMet,
    #[msg("Arithmetic overflow occurred.")]
    ArithmeticOverflow,
    #[msg("Division by zero attempted.")]
    DivisionByZero,
}

// Implementation to convert ErrorCode to ProgramError
impl From<VestingErrorCode> for ProgramError {
    fn from(e: VestingErrorCode) -> ProgramError {
        ProgramError::Custom(e as u32)
    }
}
