import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { VestingContract } from "../target/types/vesting_contract";
import {
  AccountInfo,
  Connection,
  PublicKey,
  SendTransactionError,
  Transaction,
} from "@solana/web3.js";
import {
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAssociatedTokenAddressSync,
  getAccount,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { assert } from "chai";
import ValuedToken from "./models/valuedToken";
import VestingContext from "./models/vestingContext";
import testAccount from "./vanity_accounts/testWroMBjmRex6dkA6UkcLQq8cSMLfSVmgAJFi6zoV.json";

//run local validator using:  solana-test-validator --reset --clone-upgradeable-program metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s --deactivate-feature EenyoWx9UMXYKpR8mW5Jmfmy2fRjzUtM7NduYMY8bx33 --url https://api.mainnet-beta.solana.com

const logDebug = (message: string, addNewLine: boolean = false) => {
  const newLine = addNewLine ? "\n" : "";
  if (message) console.log(`${newLine}\t${message}`);
};

const TEST_AUTHORITY_ACCOUNT = new Uint8Array(testAccount);

describe("vesting-contract", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.VestingContract as Program<VestingContract>;
  const userWallet = anchor.web3.Keypair.generate();
  const backendWallet = anchor.web3.Keypair.generate();
  const changeAuthorityWallet = anchor.web3.Keypair.generate();
  const notBackendWallet = anchor.web3.Keypair.generate();
  const program_authority = anchor.web3.Keypair.fromSecretKey(TEST_AUTHORITY_ACCOUNT);

  let valuedToken: ValuedToken;
  let vestingContext: VestingContext;
  let programVaultTokenAccounts: {
    escrowTokenVault: PublicKey;
    valuedTokenVault: PublicKey;
  };
  let userEscrowTokenAccount: PublicKey;

  async function checkBalance(account: PublicKey, name: string) {
    const balance = await provider.connection.getBalance(account);
    logDebug(`${name} balance: ${balance / anchor.web3.LAMPORTS_PER_SOL} SOL`);
    return balance;
  }

  async function getTokenBalance(tokenAccount: PublicKey, programId?: PublicKey): Promise<number> {
    const account = await getAccount(
      provider.connection,
      tokenAccount,
      undefined,
      programId ?? TOKEN_2022_PROGRAM_ID
    );
    return Number(account.amount);
  }

  before(async () => {
    // Airdrop SOL to user and backend
    const airdropAmount = 100 * anchor.web3.LAMPORTS_PER_SOL;

    logDebug("### Initializing basic assets for testing ###");
    logDebug(`User account address: ${userWallet.publicKey.toBase58()}`);
    logDebug(`Backend account address: ${backendWallet.publicKey.toBase58()}`);
    logDebug(`Program authority account ${program_authority.publicKey.toBase58()}`);
    logDebug(`1. Airdropping ${airdropAmount} Lamports to user and backend`, true);

    await Promise.all(
      [
        provider.connection.requestAirdrop(userWallet.publicKey, airdropAmount),
        provider.connection.requestAirdrop(backendWallet.publicKey, airdropAmount),
        provider.connection.requestAirdrop(changeAuthorityWallet.publicKey, airdropAmount),
        provider.connection.requestAirdrop(notBackendWallet.publicKey, airdropAmount),
      ].map((p) => p.then((sig) => provider.connection.confirmTransaction(sig)))
    );

    await checkBalance(userWallet.publicKey, "Current User");
    await checkBalance(backendWallet.publicKey, "Current Backend");
    await checkBalance(changeAuthorityWallet.publicKey, "Current backend address change authority");

    logDebug("2. Setting valued token", true);
    try {
      valuedToken = await ValuedToken.get(provider.connection);
      await valuedToken.mintTokensTo(userWallet, BigInt(15 * anchor.web3.LAMPORTS_PER_SOL));
      const userBalance = await valuedToken.getBalance(userWallet);
      logDebug(`Valued token configured with mint address ${valuedToken.mintAddress}`);
      logDebug(`Use account now has ${userBalance} valued tokens`);
    } catch (error) {
      console.error("There was an error setting up valued token. Error: ", error);
    }

    logDebug("3. Generating vesting context", true);
    try {
      vestingContext = new VestingContext({
        valuedToken,
        user: userWallet.publicKey,
        backend: backendWallet.publicKey,
        owner: program_authority.publicKey,
        programId: program.programId,
      });
      logDebug("Vesting context succesfully generated");
    } catch (error) {
      console.error("There was an error setting up valued token. Error: ", error);
    }

    logDebug("### Finished initial configuration for tests ###", true);
  });

  it("Sets a backend account", async () => {
    try {
      await program.methods
        .setBackendAccount({
          newBackendAccount: backendWallet.publicKey,
          newAuthority: null,
        })
        .accounts({
          backend_data: vestingContext.backendDataAccount,
          payer: changeAuthorityWallet.publicKey,
          programData: vestingContext.programDataAccount,
        })
        .signers([changeAuthorityWallet])
        .rpc();
      assert.fail("Transaction with wrong signer should fail");
    } catch (error) {
      assert.include(
        error.message,
        "UnathorizedToExecute",
        "Transaction should be refejected with UnathorizedToExecute error code"
      );
    }

    const tx = await program.methods
      .setBackendAccount({
        newBackendAccount: backendWallet.publicKey,
        newAuthority: changeAuthorityWallet.publicKey,
      })
      .accounts({
        backend_data: vestingContext.backendDataAccount,
        payer: program_authority.publicKey,
        programData: vestingContext.programDataAccount,
      })
      .signers([program_authority])
      .rpc();
    await provider.connection.confirmTransaction(tx);

    const txWithAuthority = await program.methods
      .setBackendAccount({
        newBackendAccount: backendWallet.publicKey,
        newAuthority: null,
      })
      .accounts({
        backend_data: vestingContext.backendDataAccount,
        payer: changeAuthorityWallet.publicKey,
        programData: vestingContext.programDataAccount,
      })
      .signers([changeAuthorityWallet])
      .rpc();
    await provider.connection.confirmTransaction(txWithAuthority);
    const backendDataAccount = await program.account.backendAccountData.fetch(
      vestingContext.backendDataAccount
    );
    logDebug(`Program backend account set to ${backendDataAccount.backendAccount.toBase58()}`);
    assert.equal(backendWallet.publicKey.toBase58(), backendDataAccount.backendAccount.toBase58());
  });

  it("Initializes a new escrow token", async () => {
    const tx = new Transaction();

    const initEscrowTx = await program.methods
      .initEscrowToken({
        name: valuedToken.description.name,
        symbol: "es" + valuedToken.description.symbol,
        uri: valuedToken.description.uri,
        appId: vestingContext.appId,
      })
      .accounts({
        valuedTokenProgram: valuedToken.mintInfo.owner,
        backend_data: vestingContext.backendDataAccount,
        vaultAccount: vestingContext.vaultAccount,
        valuedTokenMint: valuedToken.mintAddress,
        escrowTokenMint: vestingContext.escrowTokenMintAccount,
        payer: userWallet.publicKey,
        backend: backendWallet.publicKey,
      })
      .instruction();
    tx.add(initEscrowTx);

    const initTokenAccountsTx = await program.methods
      .initVaultTokenAccounts()
      .accounts({
        valuedTokenProgram: valuedToken.mintInfo.owner,
        backend_data: vestingContext.backendDataAccount,
        vaultAccount: vestingContext.vaultAccount,
        valuedTokenMint: valuedToken.mintAddress,
        escrowTokenMint: vestingContext.escrowTokenMintAccount,
        payer: userWallet.publicKey,
        backend: backendWallet.publicKey,
      })
      .instruction();
    tx.add(initTokenAccountsTx);

    const tx_receipt = await provider.connection.sendTransaction(tx, [backendWallet, userWallet]);
    await provider.connection.confirmTransaction(tx_receipt);
    const vaultData = await program.account.vaultAccount.fetch(vestingContext.vaultAccount);
    assert.equal(vaultData.creator.toBase58(), userWallet.publicKey.toBase58());
    assert.equal(
      vaultData.escrowTokenMint.toBase58(),
      vestingContext.escrowTokenMintAccount.toBase58()
    );
    assert.equal(vaultData.valuedTokenMint.toBase58(), valuedToken.mintAddress.toBase58());
    const escrowTokenVaultAccounts = await provider.connection.getTokenAccountsByOwner(
      vestingContext.vaultAccount,
      { mint: vestingContext.escrowTokenMintAccount }
    );

    const valuedTokenVaultAccounts = await provider.connection.getTokenAccountsByOwner(
      vestingContext.vaultAccount,
      { mint: valuedToken.mintAddress }
    );

    programVaultTokenAccounts = {
      escrowTokenVault: escrowTokenVaultAccounts.value[0].pubkey,
      valuedTokenVault: valuedTokenVaultAccounts.value[0].pubkey,
    };

    assert.isNotEmpty(programVaultTokenAccounts.escrowTokenVault);
    assert.isNotEmpty(programVaultTokenAccounts.valuedTokenVault);

    assert.equal(vaultData.appId, vestingContext.appId);

    logDebug(`Token initialized`);
  });

  it("Updates a escrow token metadata", async () => {
    const newName = "Token Changed Name";
    const newSymbol = "chgToken";
    const newUri = "changed:https";
    const mintAccountParsed = await provider.connection.getParsedAccountInfo(
      new PublicKey(vestingContext.escrowTokenMintAccount)
    );
    const parsedData = mintAccountParsed.value.data as anchor.web3.ParsedAccountData;
    const tokenMetadata: {
      name: string;
      symbol: string;
      uri: string;
    } = parsedData.parsed.info.extensions[1].state;
    logDebug(`Initial token metadata: ${JSON.stringify(tokenMetadata)}`);
    const tx = new Transaction();
    tx.add(
      await program.methods
        .changeEscrowMetadata({
          paramKey: "name",
          value: newName,
        })
        .accounts({
          backend_data: vestingContext.backendDataAccount,
          vaultAccount: vestingContext.vaultAccount,
          valuedTokenMint: valuedToken.mintAddress,
          escrowTokenMint: vestingContext.escrowTokenMintAccount,
          payer: userWallet.publicKey,
          backend: backendWallet.publicKey,
        })
        .instruction()
    );
    tx.add(
      await program.methods
        .changeEscrowMetadata({
          paramKey: "symbol",
          value: newSymbol,
        })
        .accounts({
          backend_data: vestingContext.backendDataAccount,
          vaultAccount: vestingContext.vaultAccount,
          valuedTokenMint: valuedToken.mintAddress,
          escrowTokenMint: vestingContext.escrowTokenMintAccount,
          payer: userWallet.publicKey,
          backend: backendWallet.publicKey,
        })
        .instruction()
    );
    tx.add(
      await program.methods
        .changeEscrowMetadata({
          paramKey: "uri",
          value: newUri,
        })
        .accounts({
          backend_data: vestingContext.backendDataAccount,
          vaultAccount: vestingContext.vaultAccount,
          valuedTokenMint: valuedToken.mintAddress,
          escrowTokenMint: vestingContext.escrowTokenMintAccount,
          payer: userWallet.publicKey,
          backend: backendWallet.publicKey,
        })
        .instruction()
    );
    const tx_receipt = await provider.connection.sendTransaction(tx, [backendWallet, userWallet]);
    await provider.connection.confirmTransaction(tx_receipt);
    const newMintAccountParsed = await provider.connection.getParsedAccountInfo(
      new PublicKey(vestingContext.escrowTokenMintAccount)
    );
    const newParsedData = newMintAccountParsed.value.data as anchor.web3.ParsedAccountData;
    const newTokenMetadata: {
      name: string;
      symbol: string;
      uri: string;
    } = newParsedData.parsed.info.extensions[1].state;
    assert.equal(newTokenMetadata.name, newName);
    assert.equal(newTokenMetadata.symbol, newSymbol);
    assert.equal(newTokenMetadata.uri, newUri);
    logDebug(`Changed token metadata: ${JSON.stringify(newTokenMetadata)}`);
  });

  it("Exchanges tokens with 1:1 ratio", async () => {
    const exchangeAmount = new anchor.BN(5000000000); // 5 tokens

    const userInitialBalance = await valuedToken.getBalance(userWallet);
    logDebug(`Current user valued token balance: ${userInitialBalance}`);
    const valuedVaultBalance = await getTokenBalance(
      programVaultTokenAccounts.valuedTokenVault,
      valuedToken.mintInfo.owner
    );
    logDebug(`Current vault valued token balance: ${valuedVaultBalance}`);

    const escrowVaultInitialBalance = await getTokenBalance(
      programVaultTokenAccounts.escrowTokenVault
    );
    logDebug(`Current vault escrow token balance: ${escrowVaultInitialBalance}`);

    const tx = await program.methods
      .exchange(exchangeAmount)
      .accounts({
        valuedTokenProgram: valuedToken.mintInfo.owner,
        backendData: vestingContext.backendDataAccount,
        vaultAccount: vestingContext.vaultAccount,
        valuedTokenMint: valuedToken.mintAddress,
        escrowTokenMint: vestingContext.escrowTokenMintAccount,
        user: userWallet.publicKey,
        backend: backendWallet.publicKey,
      })
      .signers([backendWallet, userWallet])
      .rpc();

    await provider.connection.confirmTransaction(tx);

    const userNewBalance = await valuedToken.getBalance(userWallet);
    logDebug(`New user valued token balance: ${userNewBalance}`);

    const newValuedVaultBalance = await getTokenBalance(
      programVaultTokenAccounts.valuedTokenVault,
      valuedToken.mintInfo.owner
    );
    logDebug(`New vault valued token balance: ${newValuedVaultBalance}`);
    assert.equal(newValuedVaultBalance.toString(), exchangeAmount.toString());

    const newEscrowVaultInitialBalance = await getTokenBalance(
      programVaultTokenAccounts.escrowTokenVault
    );
    logDebug(`New vault escrow token balance: ${newEscrowVaultInitialBalance}`);
    assert.equal(newEscrowVaultInitialBalance.toString(), "0");

    const escrowUserTokenAccounts = await provider.connection.getTokenAccountsByOwner(
      userWallet.publicKey,
      { mint: vestingContext.escrowTokenMintAccount }
    );

    userEscrowTokenAccount = escrowUserTokenAccounts.value[0].pubkey;
    const newEscrowUserTokenBalance = await getTokenBalance(userEscrowTokenAccount);
    logDebug(`New user escrow token balance: ${newEscrowUserTokenBalance}`);
    assert.equal(newEscrowUserTokenBalance.toString(), exchangeAmount.toString());
  });

  it("Creates a vesting session with correct amount", async () => {
    const toVestAmount = new anchor.BN(3000000000); // 3 tokens

    const escrowUserTokenBalance = await getTokenBalance(userEscrowTokenAccount);
    assert.equal(escrowUserTokenBalance.toString(), "5000000000");
    logDebug(`Current user escrow token balance: ${escrowUserTokenBalance}`);

    const userInitialBalance = await valuedToken.getBalance(userWallet);
    logDebug(`Current user valued token balance: ${userInitialBalance}`);

    const valuedVaultBalance = await getTokenBalance(
      programVaultTokenAccounts.valuedTokenVault,
      valuedToken.mintInfo.owner
    );
    logDebug(`Current vault valued token balance: ${valuedVaultBalance}`);

    const escrowVaultInitialBalance = await getTokenBalance(
      programVaultTokenAccounts.escrowTokenVault
    );
    logDebug(`Current vault escrow token balance: ${escrowVaultInitialBalance}`);

    const vaultSessionsAccounts = vestingContext.getVaultSessionsAccount(userWallet.publicKey);
    let sessionsAccountData = null;
    try {
      sessionsAccountData = await program.account.vestingSessionsAccount.fetch(
        vaultSessionsAccounts
      );
    } catch (error) {
      assert.include(error.message, "Account does not exist or has no data");
    }
    const lastSessionId = sessionsAccountData?.lastSessionId ?? new anchor.BN(0);
    const newVestingSessionAccount = vestingContext.getVaulSessionAccount(
      vaultSessionsAccounts,
      lastSessionId
    );

    const tx = await program.methods
      .createVestingSession(toVestAmount)
      .accounts({
        backendData: vestingContext.backendDataAccount,
        vestingSessionsAccount: vaultSessionsAccounts,
        vestingSessionAccount: newVestingSessionAccount,
        vaultAccount: vestingContext.vaultAccount,
        valuedTokenMint: valuedToken.mintAddress,
        escrowTokenMint: vestingContext.escrowTokenMintAccount,
        user: userWallet.publicKey,
        backend: backendWallet.publicKey,
      })
      .signers([backendWallet, userWallet])
      .rpc();

    await provider.connection.confirmTransaction(tx);
    logDebug(`Vesting session created`);

    const afterVestEscrowUserTokenBalance = await getTokenBalance(userEscrowTokenAccount);
    assert.equal(afterVestEscrowUserTokenBalance.toString(), "2000000000");
    logDebug(`Current user escrow token balance: ${afterVestEscrowUserTokenBalance}`);

    const afterVestEscrowVaultBalance = await getTokenBalance(
      programVaultTokenAccounts.escrowTokenVault
    );
    assert.equal(afterVestEscrowVaultBalance.toString(), toVestAmount.toString());
    logDebug(`Current vault escrow token balance: ${afterVestEscrowVaultBalance}`);

    // Fetch and check vesting session data
    const vestingSessionData = await program.account.vestingSession.fetch(newVestingSessionAccount);
    assert.equal(
      vestingSessionData.amount.toNumber(),
      toVestAmount.toNumber(),
      "Vesting session amount should match"
    );
    assert.equal(
      vestingSessionData.amountWithdrawn.toNumber(),
      0,
      "Initial withdrawn amount should be 0"
    );
    assert(vestingSessionData.startDate.toNumber() > 0, "Start date should be set");
    assert.equal(
      vestingSessionData.lastWithdrawAt.toNumber(),
      0,
      "Initial last withdraw time should be 0"
    );
    assert.equal(
      vestingSessionData.cancelledAt.toNumber(),
      0,
      "Initial cancelled time should be 0"
    );

    logDebug(`Generated vesting session: ${JSON.stringify(vestingSessionData)}`);
  });

  it("Withdraws correct amount from a vesting session", async () => {
    // Wait for a minute to pass for vesting
    logDebug("Waiting a minute to pass...");
    await new Promise((resolve) => setTimeout(resolve, 60 * 1000));
    logDebug("A minute passed");

    const escrowUserTokenBalance = await getTokenBalance(userEscrowTokenAccount);
    logDebug(`Current user escrow token balance: ${escrowUserTokenBalance}`);

    const userValuedTokenBalance = await valuedToken.getBalance(userWallet);
    logDebug(`Current user valued token balance: ${userValuedTokenBalance}`);

    const valuedVaultBalance = await getTokenBalance(
      programVaultTokenAccounts.valuedTokenVault,
      valuedToken.mintInfo.owner
    );
    logDebug(`Current vault valued token balance: ${valuedVaultBalance}`);

    const escrowVaultInitialBalance = await getTokenBalance(
      programVaultTokenAccounts.escrowTokenVault
    );
    logDebug(`Current vault escrow token balance: ${escrowVaultInitialBalance}`);

    const vaultSessionsAccounts = vestingContext.getVaultSessionsAccount(userWallet.publicKey);
    const sessionsAccountData = await program.account.vestingSessionsAccount.fetch(
      vaultSessionsAccounts
    );
    const lastSessionId = sessionsAccountData.lastSessionId;
    assert.equal(lastSessionId.toNumber(), 1);
    const vestingSessionAccount = vestingContext.getVaulSessionAccount(
      vaultSessionsAccounts,
      lastSessionId.sub(new anchor.BN(1))
    );

    const tx = await program.methods
      .sessionWithdraw()
      .accounts({
        valuedTokenProgram: valuedToken.mintInfo.owner,
        backendData: vestingContext.backendDataAccount,
        vestingSessionsAccount: vaultSessionsAccounts,
        vestingSessionAccount: vestingSessionAccount,
        vaultAccount: vestingContext.vaultAccount,
        valuedTokenMint: valuedToken.mintAddress,
        escrowTokenMint: vestingContext.escrowTokenMintAccount,
        user: userWallet.publicKey,
        backend: backendWallet.publicKey,
      })
      .signers([backendWallet, userWallet])
      .rpc();

    await provider.connection.confirmTransaction(tx);
    console.log("Withdrawn from vesting session");

    const afterWithdrawEscrowUserTokenBalance = await getTokenBalance(userEscrowTokenAccount);
    logDebug(`Current user escrow token balance: ${afterWithdrawEscrowUserTokenBalance}`);

    const afterWithdrawUserValuedTokenBalance = await valuedToken.getBalance(userWallet);
    logDebug(`Current user valued token balance: ${afterWithdrawUserValuedTokenBalance}`);

    const afterWithdrawValuedVaultBalance = await getTokenBalance(
      programVaultTokenAccounts.valuedTokenVault,
      valuedToken.mintInfo.owner
    );
    logDebug(`Current vault valued token balance: ${afterWithdrawValuedVaultBalance}`);

    const afterWithdrawEscrowVaultInitialBalance = await getTokenBalance(
      programVaultTokenAccounts.escrowTokenVault
    );
    logDebug(`Current vault escrow token balance: ${afterWithdrawEscrowVaultInitialBalance}`);

    // Fetch and check updated vesting session data
    const vestingSessionData = await program.account.vestingSession.fetch(vestingSessionAccount);
    assert.equal(
      vestingSessionData.amountWithdrawn.toString(),
      (afterWithdrawUserValuedTokenBalance - userValuedTokenBalance).toString(),
      "Withdrawn amount should be greater than 0"
    );
    assert(
      vestingSessionData.lastWithdrawAt.toNumber() > vestingSessionData.startDate.toNumber(),
      "Last withdraw time should be updated"
    );
  });

  it("Cancels a vesting session correctly", async () => {
    // Wait for some time to pass for partial vesting
    logDebug("Waiting a minute to pass...");
    await new Promise((resolve) => setTimeout(resolve, 60 * 1000));
    logDebug("A minute passed");

    const escrowUserTokenBalance = await getTokenBalance(userEscrowTokenAccount);
    logDebug(`Current user escrow token balance: ${escrowUserTokenBalance}`);

    const userValuedTokenBalance = await valuedToken.getBalance(userWallet);
    logDebug(`Current user valued token balance: ${userValuedTokenBalance}`);

    const valuedVaultBalance = await getTokenBalance(
      programVaultTokenAccounts.valuedTokenVault,
      valuedToken.mintInfo.owner
    );
    logDebug(`Current vault valued token balance: ${valuedVaultBalance}`);

    const escrowVaultInitialBalance = await getTokenBalance(
      programVaultTokenAccounts.escrowTokenVault
    );
    logDebug(`Current vault escrow token balance: ${escrowVaultInitialBalance}`);

    const vaultSessionsAccounts = vestingContext.getVaultSessionsAccount(userWallet.publicKey);
    const sessionsAccountData = await program.account.vestingSessionsAccount.fetch(
      vaultSessionsAccounts
    );
    const lastSessionId = sessionsAccountData.lastSessionId;
    assert.equal(lastSessionId.toNumber(), 1);
    const vestingSessionAccount = vestingContext.getVaulSessionAccount(
      vaultSessionsAccounts,
      lastSessionId.sub(new anchor.BN(1))
    );

    const tx = await program.methods
      .sessionCancel()
      .accounts({
        valuedTokenProgram: valuedToken.mintInfo.owner,
        backendData: vestingContext.backendDataAccount,
        vestingSessionsAccount: vaultSessionsAccounts,
        vestingSessionAccount: vestingSessionAccount,
        vaultAccount: vestingContext.vaultAccount,
        valuedTokenMint: valuedToken.mintAddress,
        escrowTokenMint: vestingContext.escrowTokenMintAccount,
        user: userWallet.publicKey,
        backend: backendWallet.publicKey,
      })
      .signers([backendWallet, userWallet])
      .rpc();

    await provider.connection.confirmTransaction(tx);
    logDebug("Vesting session cancelled");

    const afterCancelEscrowUserTokenBalance = await getTokenBalance(userEscrowTokenAccount);
    logDebug(`Current user escrow token balance: ${afterCancelEscrowUserTokenBalance}`);

    const afterCancelUserValuedTokenBalance = await valuedToken.getBalance(userWallet);
    logDebug(`Current user valued token balance: ${afterCancelUserValuedTokenBalance}`);

    const afterCancelValuedVaultBalance = await getTokenBalance(
      programVaultTokenAccounts.valuedTokenVault,
      valuedToken.mintInfo.owner
    );
    logDebug(`Current vault valued token balance: ${afterCancelValuedVaultBalance}`);

    const afterCancelEscrowVaultBalance = await getTokenBalance(
      programVaultTokenAccounts.escrowTokenVault
    );
    logDebug(`Current vault escrow token balance: ${afterCancelEscrowVaultBalance}`);

    // Fetch the vesting session data to calculate expected values
    const vestingSessionData = await program.account.vestingSession.fetch(vestingSessionAccount);
    const vestedAmount = vestingSessionData.amountWithdrawn;

    // Verify balances
    assert(afterCancelUserValuedTokenBalance >= userValuedTokenBalance);
    assert(afterCancelEscrowUserTokenBalance >= escrowUserTokenBalance);
    assert(afterCancelEscrowVaultBalance <= escrowVaultInitialBalance);
    assert(afterCancelValuedVaultBalance <= valuedVaultBalance);

    const amountValuedReleasedToUser = afterCancelUserValuedTokenBalance - userValuedTokenBalance;
    const amountReturnedToEscrow = escrowVaultInitialBalance - escrowVaultInitialBalance;
    const amountRemovedFromVaultValued = valuedVaultBalance - afterCancelValuedVaultBalance;

    console.log("Amount released to user:", amountValuedReleasedToUser);
    console.log("Amount returned to escrow:", amountReturnedToEscrow);
    console.log("Amount removed from vault valued account:", amountRemovedFromVaultValued);

    // assert.approximately(
    //   amountReleasedToUser,
    //   amountRemovedFromVaultValued,
    //   1,
    //   "Released amount should match removed amount"
    // );
    // // Verify vesting session data
    // assert(vestingSessionData.cancelledAt.toNumber() > 0, "Cancelled time should be set");
    // assert.equal(
    //   vestingSessionData.amountWithdrawn.toNumber(),
    //   vestedAmount.toNumber(),
    //   "Withdrawn amount should match vested amount"
    // );

    // Verify that we can't withdraw after cancellation
    try {
      await program.methods
        .sessionWithdraw()
        .accounts({
          valuedTokenProgram: valuedToken.mintInfo.owner,
          backendData: vestingContext.backendDataAccount,
          vestingSessionsAccount: vaultSessionsAccounts,
          vestingSessionAccount: vestingSessionAccount,
          vaultAccount: vestingContext.vaultAccount,
          valuedTokenMint: valuedToken.mintAddress,
          escrowTokenMint: vestingContext.escrowTokenMintAccount,
          user: userWallet.publicKey,
          backend: backendWallet.publicKey,
        })
        .signers([backendWallet, userWallet])
        .rpc();

      assert.fail("Should not be able to withdraw after cancellation");
    } catch (error) {
      assert.include(error.message, "Interacting with canceled session");
    }
  });

  it("Allows the user to exist from the session as a fail safe", async () => {
    const toVestAmount = new anchor.BN(1000000000); // 1 tokens
    const vaultSessionsAccounts = vestingContext.getVaultSessionsAccount(userWallet.publicKey);
    const sessionsAccountData = await program.account.vestingSessionsAccount.fetch(
      vaultSessionsAccounts
    );
    const lastSessionId = sessionsAccountData?.lastSessionId;
    const newVestingSessionAccount = vestingContext.getVaulSessionAccount(
      vaultSessionsAccounts,
      lastSessionId
    );

    const createVestingtx = await program.methods
      .createVestingSession(toVestAmount)
      .accounts({
        backendData: vestingContext.backendDataAccount,
        vestingSessionsAccount: vaultSessionsAccounts,
        vestingSessionAccount: newVestingSessionAccount,
        vaultAccount: vestingContext.vaultAccount,
        valuedTokenMint: valuedToken.mintAddress,
        escrowTokenMint: vestingContext.escrowTokenMintAccount,
        user: userWallet.publicKey,
        backend: backendWallet.publicKey,
      })
      .signers([backendWallet, userWallet])
      .rpc();

    await provider.connection.confirmTransaction(createVestingtx);

    const escrowUserTokenBalance = await getTokenBalance(userEscrowTokenAccount);
    logDebug(`Current user escrow token balance: ${escrowUserTokenBalance}`);

    const userValuedTokenBalance = await valuedToken.getBalance(userWallet);
    logDebug(`Current user valued token balance: ${userValuedTokenBalance}`);

    const valuedVaultBalance = await getTokenBalance(
      programVaultTokenAccounts.valuedTokenVault,
      valuedToken.mintInfo.owner
    );
    logDebug(`Current vault valued token balance: ${valuedVaultBalance}`);

    const escrowVaultInitialBalance = await getTokenBalance(
      programVaultTokenAccounts.escrowTokenVault
    );
    logDebug(`Current vault escrow token balance: ${escrowVaultInitialBalance}`);

    const sesssionExitTx = await program.methods
      .sessionExit()
      .accounts({
        valuedTokenProgram: valuedToken.mintInfo.owner,
        backendData: vestingContext.backendDataAccount,
        vestingSessionsAccount: vaultSessionsAccounts,
        vestingSessionAccount: newVestingSessionAccount,
        vaultAccount: vestingContext.vaultAccount,
        valuedTokenMint: valuedToken.mintAddress,
        escrowTokenMint: vestingContext.escrowTokenMintAccount,
        user: userWallet.publicKey,
        backend: backendWallet.publicKey,
      })
      .signers([backendWallet, userWallet])
      .rpc();

    await provider.connection.confirmTransaction(sesssionExitTx);
    logDebug("Vesting session exited");

    const afterExitEscrowUserTokenBalance = await getTokenBalance(userEscrowTokenAccount);
    logDebug(`After exit user escrow token balance: ${afterExitEscrowUserTokenBalance}`);

    const afterExitUserValuedTokenBalance = await valuedToken.getBalance(userWallet);
    logDebug(`After exit user valued token balance: ${afterExitUserValuedTokenBalance}`);

    const afterExitValuedVaultBalance = await getTokenBalance(
      programVaultTokenAccounts.valuedTokenVault,
      valuedToken.mintInfo.owner
    );
    logDebug(`After exit vault valued token balance: ${afterExitValuedVaultBalance}`);

    const afterExitEscrowVaultInitialBalance = await getTokenBalance(
      programVaultTokenAccounts.escrowTokenVault
    );
    logDebug(`After exit vault escrow token balance: ${afterExitEscrowVaultInitialBalance}`);

    // const finalUserBalance = await getTokenBalance(
    //   userValuedTokenAccountPubKey,
    //   valuedTokenMintInfo.owner
    // );
    // const finalVaultValuedBalance = await getTokenBalance(
    //   valuedVaultTokenAccount,
    //   valuedTokenMintInfo.owner
    // );

    // // Fetch the vesting session data to calculate expected values
    // const vestingSessionData = await program.account.vestingSession.fetch(vestingSessionAccount);
    // const vestedAmount = vestingSessionData.amountWithdrawn;

    // // Verify balances
    // assert(
    //   finalUserBalance >= initialUserBalance + vestingAmount.toNumber(),
    //   "User balance should stay the same or increase"
    // );

    // assert(
    //   finalVaultValuedBalance <= initialVaultValuedBalance - vestingAmount.toNumber(),
    //   "Vault valued balance should stay the same or decrease"
    // );

    // const amountReleasedToUser = finalUserBalance - initialUserBalance;
    // const amountRemovedFromVaultValued = initialVaultValuedBalance - finalVaultValuedBalance;

    // console.log("Amount released to user:", amountReleasedToUser);
    // console.log("Amount removed from vault valued account:", amountRemovedFromVaultValued);

    // assert.approximately(
    //   amountReleasedToUser,
    //   amountRemovedFromVaultValued,
    //   1,
    //   "Released amount should match removed amount"
    // );
    // // Verify vesting session data
    // assert(vestingSessionData.cancelledAt.toNumber() > 0, "Cancelled time should be set");
    // assert.equal(
    //   vestingSessionData.amountWithdrawn.toNumber(),
    //   vestedAmount.toNumber(),
    //   "Withdrawn amount should match vested amount"
    // );
  });

  it("Exchanges tokens and takes from escrow vault", async () => {
    const exchangeAmount = new anchor.BN(5000000000); // 5 tokens

    const userInitialBalance = await valuedToken.getBalance(userWallet);
    logDebug(`Current user valued token balance: ${userInitialBalance}`);
    const valuedVaultBalance = await getTokenBalance(
      programVaultTokenAccounts.valuedTokenVault,
      valuedToken.mintInfo.owner
    );
    logDebug(`Current vault valued token balance: ${valuedVaultBalance}`);

    const escrowVaultInitialBalance = await getTokenBalance(
      programVaultTokenAccounts.escrowTokenVault
    );
    logDebug(`Current vault escrow token balance: ${escrowVaultInitialBalance}`);

    const escrowUserTokenBalance = await getTokenBalance(userEscrowTokenAccount);
    logDebug(`Current user escrow token balance: ${escrowUserTokenBalance}`);

    const tx = await program.methods
      .exchange(exchangeAmount)
      .accounts({
        valuedTokenProgram: valuedToken.mintInfo.owner,
        backendData: vestingContext.backendDataAccount,
        vaultAccount: vestingContext.vaultAccount,
        valuedTokenMint: valuedToken.mintAddress,
        escrowTokenMint: vestingContext.escrowTokenMintAccount,
        user: userWallet.publicKey,
        backend: backendWallet.publicKey,
      })
      .signers([backendWallet, userWallet])
      .rpc();

    await provider.connection.confirmTransaction(tx);

    const userNewBalance = await valuedToken.getBalance(userWallet);
    logDebug(`New user valued token balance: ${userNewBalance}`);

    const newValuedVaultBalance = await getTokenBalance(
      programVaultTokenAccounts.valuedTokenVault,
      valuedToken.mintInfo.owner
    );
    logDebug(`New vault valued token balance: ${newValuedVaultBalance}`);
    assert.equal(
      newValuedVaultBalance.toString(),
      exchangeAmount.add(new anchor.BN(valuedVaultBalance)).toString()
    );

    const newEscrowVaultInitialBalance = await getTokenBalance(
      programVaultTokenAccounts.escrowTokenVault
    );
    logDebug(`New vault escrow token balance: ${newEscrowVaultInitialBalance}`);
    assert.equal(newEscrowVaultInitialBalance.toString(), "0");

    const escrowUserTokenAccounts = await provider.connection.getTokenAccountsByOwner(
      userWallet.publicKey,
      { mint: vestingContext.escrowTokenMintAccount }
    );

    userEscrowTokenAccount = escrowUserTokenAccounts.value[0].pubkey;
    const newEscrowUserTokenBalance = await getTokenBalance(userEscrowTokenAccount);
    logDebug(`New user escrow token balance: ${newEscrowUserTokenBalance}`);
    assert.equal(
      newEscrowUserTokenBalance.toString(),
      exchangeAmount.add(new anchor.BN(escrowUserTokenBalance)).toString()
    );
  });

  // // Additional security tests
  // it("Handles rapid sequential withdrawals correctly", async () => {
  //   // Create a new vesting session

  //   [vestingSessionAccount] = PublicKey.findProgramAddressSync(
  //     [
  //       Buffer.from("a_vesting_session_account"),
  //       vestingSessionsAccount.toBuffer(),
  //       new anchor.BN(currentSessionId).toArrayLike(Buffer, "le", 8),
  //     ],
  //     program.programId
  //   );
  //   currentSessionId++;

  //   const vestingAmount = new anchor.BN(1000000000);
  //   await program.methods
  //     .createVestingSession(vestingAmount)
  //     .accounts({
  //       owner,
  //       vestingSessionsAccount,
  //       vestingSessionAccount,
  //       user: userWallet.publicKey,
  //       backend: backendWallet.publicKey,
  //       vaultAccount,
  //       escrowVaultTokenAccount,
  //       userEscrowTokenAccount,
  //       valuedTokenMint,
  //       escrowTokenMint,
  //     })
  //     .signers([backendWallet, userWallet])
  //     .rpc();

  //   // Wait for a minute to pass for vesting
  //   await new Promise((resolve) => setTimeout(resolve, 60 * 1000));

  //   // Perform multiple rapid withdrawals
  //   const withdrawalPromises = [];
  //   for (let i = 0; i < 5; i++) {
  //     withdrawalPromises.push(
  //       program.methods
  //         .sessionWithdraw()
  //         .accounts({
  //           owner,
  //           vestingSessionsAccount,
  //           vestingSessionAccount,
  //           vaultAccount,
  //           valuedVaultTokenAccount,
  //           user: userWallet.publicKey,
  //           userValuedTokenAccount: userValuedTokenAccountPubKey,
  //           backend: backendWallet.publicKey,
  //           valuedTokenMint,
  //           escrowTokenMint,
  //           tokenProgram: valuedTokenMintInfo.owner,
  //         })
  //         .signers([backendWallet, userWallet])
  //         .rpc()
  //     );
  //   }

  //   try {
  //     // Wait for all withdrawals to complete
  //     await Promise.all(withdrawalPromises);

  //     assert.fail(
  //       "Should not be able to withdraw more than one time in same minute"
  //     );
  //   } catch {}
  // });

  // it("Fails to withdraw with incorrect authority", async () => {
  //   const maliciousUser = anchor.web3.Keypair.generate();

  //   try {
  //     await program.methods
  //       .sessionWithdraw()
  //       .accounts({
  //         owner,
  //         vestingSessionsAccount,
  //         vestingSessionAccount,
  //         vaultAccount,
  //         valuedVaultTokenAccount,
  //         user: maliciousUser.publicKey,
  //         userValuedTokenAccount: userValuedTokenAccountPubKey,
  //         backend: backendWallet.publicKey,
  //         valuedTokenMint,
  //         escrowTokenMint,
  //         tokenProgram: valuedTokenMintInfo.owner,
  //       })
  //       .signers([maliciousUser, backendWallet])
  //       .rpc();

  //     assert.fail("Should have thrown an error");
  //   } catch (error) {
  //     // assert.include(error.message, "A seeds constraint was violated'");
  //   }
  // });

  // it("Fails to cancel session with incorrect authority", async () => {
  //   const maliciousUser = anchor.web3.Keypair.generate();

  //   try {
  //     await program.methods
  //       .sessionCancel()
  //       .accounts({
  //         owner,
  //         vestingSessionsAccount,
  //         vestingSessionAccount,
  //         vaultAccount,
  //         valuedVaultTokenAccount,
  //         escrowVaultTokenAccount,
  //         user: maliciousUser.publicKey,
  //         userValuedTokenAccount: userValuedTokenAccountPubKey,
  //         userEscrowTokenAccount,
  //         backend: backendWallet.publicKey,
  //         valuedTokenMint,
  //         escrowTokenMint,
  //         valuedTokenProgram: valuedTokenMintInfo.owner,
  //       })
  //       .signers([maliciousUser, backendWallet])
  //       .rpc();

  //     assert.fail("Should have thrown an error");
  //   } catch (error) {
  //     // assert.include(error.message, "A has_one constraint was violated");
  //   }
  // });
});
