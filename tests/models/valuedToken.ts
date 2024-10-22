import * as anchor from "@coral-xyz/anchor";
import { createAssociatedTokenAccount, createMint, getAccount, mintTo } from "@solana/spl-token";
import { AccountInfo, PublicKey } from "@solana/web3.js";

class ValuedToken {
  private static instance?: ValuedToken;
  private readonly ownerWallet: anchor.web3.Keypair;
  private readonly connection: anchor.web3.Connection;
  private readonly tokenAccounts: { [ account: string ]: anchor.web3.PublicKey };

  mintAddress: PublicKey;
  mintInfo: AccountInfo<Buffer>;    
  description = {
    name: "Test Valued Token",
    symbol: "TVT",
    uri: "https://test.com",
    decimalPrecision: 9
  };

  private constructor(connection: anchor.web3.Connection){
      this.connection = connection;
      this.ownerWallet = anchor.web3.Keypair.generate();
      this.tokenAccounts = {};
  }

  static async get(connection: anchor.web3.Connection) {
      if(!this.instance){
          const newValueToken = new ValuedToken(connection);
          const txSig = await connection.requestAirdrop(newValueToken.ownerWallet.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL);
          await connection.confirmTransaction(txSig);
          newValueToken.mintAddress = await createMint(
              connection,
              newValueToken.ownerWallet,
              newValueToken.ownerWallet.publicKey,
              null,
              newValueToken.description.decimalPrecision
          );
          newValueToken.mintInfo = await connection.getAccountInfo(newValueToken.mintAddress);
          this.instance = newValueToken;
      }
      return this.instance;
  }

  async getTokenAccount(userWallet: anchor.web3.Keypair) {
    const userWalletAddress = userWallet.publicKey.toBase58();
    if(!this.tokenAccounts[userWalletAddress]) {
      this.tokenAccounts[userWalletAddress] = await createAssociatedTokenAccount(
        this.connection,
        userWallet,
        this.mintAddress,
        userWallet.publicKey
      );
      
    }
    return this.tokenAccounts[userWalletAddress];
  }   

  async mintTokensTo(receiverWallet: anchor.web3.Keypair, amount: bigint){
    const userTokenAccount = await this.getTokenAccount(receiverWallet);
    await mintTo(
      this.connection, 
      receiverWallet, 
      this.mintAddress, 
      userTokenAccount,
      this.ownerWallet,
      amount
    );
  } 

  async getBalance(userWallet: anchor.web3.Keypair) {
    const userTokenAccount = await this.getTokenAccount(userWallet);
    const tokenAccount = await getAccount(this.connection, userTokenAccount);
    return tokenAccount.amount;
  }

}

export default ValuedToken;