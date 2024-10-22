import { PublicKey } from "@solana/web3.js";
import ValuedToken from "./valuedToken";
import BN from "bn.js";

interface IVestingContextParams {
  valuedToken: ValuedToken;
  user: PublicKey;
  backend: PublicKey;
  owner: PublicKey;
  programId: PublicKey;
}

class VestingContext {
  escrowTokenMintAccount: PublicKey;
  vaultAccount: PublicKey;
  vestingSessionsAccount: PublicKey;
  backendDataAccount: PublicKey;
  programDataAccount = new PublicKey("2apvde2rstcLrHaXeTz7vfoDcW1RfVgRjrDXNMN9Gms7");
  private readonly programId;

  constructor(contextParams: IVestingContextParams) {
    const valuedToken = contextParams.valuedToken;
    this.programId = contextParams.programId;

    [this.backendDataAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("backend_data")],
      this.programId
    );

    [this.escrowTokenMintAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow_mint"), valuedToken.mintAddress.toBuffer()],
      this.programId
    );

    [this.vaultAccount] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("token_vault"),
        valuedToken.mintAddress.toBuffer(),
        this.escrowTokenMintAccount.toBuffer(),
      ],
      this.programId
    );
  }

  public getVaultSessionsAccount(user: PublicKey) {
    const [publicKey] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("user_vesting_session_collection"),
        this.vaultAccount.toBuffer(),
        user.toBuffer(),
      ],
      this.programId
    );
    return publicKey;
  }

  public getVaulSessionAccount(vaultSesions: PublicKey, lastSessionId: BN) {
    const [publicKey] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("user_vesting_session"),
        vaultSesions.toBuffer(),
        lastSessionId.toArrayLike(Buffer, "le", 8),
      ],
      this.programId
    );
    return publicKey;
  }
}

export default VestingContext;
