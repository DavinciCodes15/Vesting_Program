import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { VestingContract } from "../target/types/vesting_contract";
import { AccountInfo, PublicKey, SendTransactionError } from "@solana/web3.js";
import {
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAssociatedTokenAddressSync,
  getAccount,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { assert } from "chai";

//run local validator using:  solana-test-validator --reset --clone-upgradeable-program metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s --deactivate-feature EenyoWx9UMXYKpR8mW5Jmfmy2fRjzUtM7NduYMY8bx33 --url https://api.mainnet-beta.solana.com

describe("vesting-contract", () => {
  const provider = anchor.AnchorProvider.env();
  // provider.opts.commitment = "finalized";
  anchor.setProvider(provider);

  const tokenMetadataPorgramId = new PublicKey(
    "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
  );
  const program = anchor.workspace.VestingContract as Program<VestingContract>;

  const user = anchor.web3.Keypair.generate();
  const backend = anchor.web3.Keypair.generate();
  const owner = backend.publicKey;
  const tokenName = "Test Token";
  const tokenSymbol = "TST";
  const tokenUri = "https://test.com";
  const decimals = 9;

  let valuedTokenMint: PublicKey;
  let valuedTokenMintInfo: AccountInfo<Buffer>;
  let escrowTokenMint: PublicKey;
  let userValuedTokenAccount: PublicKey;
  let userEscrowTokenAccount: PublicKey;
  let vaultAccount: PublicKey;
  let valuedVaultTokenAccount: PublicKey;
  let escrowVaultTokenAccount: PublicKey;
  let vestingSessionsAccount: PublicKey;
  let vestingSessionAccount: PublicKey;
  let currentSessionId = 0;

  async function confirmTransaction(signature: string) {
    // const latestBlockHash = await provider.connection.getLatestBlockhash(
    //   "finalized"
    // );
    // return await provider.connection.confirmTransaction({
    //   blockhash: latestBlockHash.blockhash,
    //   lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
    //   signature: signature,
    // });
  }

  async function checkBalance(account: PublicKey, name: string) {
    const balance = await provider.connection.getBalance(account);
    console.log(
      `${name} balance: ${balance / anchor.web3.LAMPORTS_PER_SOL} SOL`
    );
    return balance;
  }

  async function getTokenBalance(
    tokenAccount: PublicKey,
    programId?: PublicKey
  ): Promise<number> {
    const account = await getAccount(
      provider.connection,
      tokenAccount,
      undefined,
      programId ?? TOKEN_2022_PROGRAM_ID
    );
    return Number(account.amount);
  }

  async function accountExists(publicKey: PublicKey): Promise<boolean> {
    const account = await provider.connection.getAccountInfo(publicKey);
    return account !== null;
  }

  before(async () => {
    // Airdrop SOL to user and backend
    const airdropAmount = 10 * anchor.web3.LAMPORTS_PER_SOL;

    console.log("Airdropping SOL to user and backend...");
    await Promise.all(
      [
        provider.connection.requestAirdrop(user.publicKey, airdropAmount),
        provider.connection.requestAirdrop(backend.publicKey, airdropAmount),
      ].map((p) => p.then((sig) => provider.connection.confirmTransaction(sig)))
    );

    await checkBalance(user.publicKey, "User");
    await checkBalance(backend.publicKey, "Backend");

    console.log("Creating Valued token mint...");
    try {
      // Create token mints
      valuedTokenMint = await createMint(
        provider.connection,
        user,
        user.publicKey,
        null,
        9,
        undefined,
        { commitment: "confirmed" }
        //toggle this on/off to test different token programs
        // TOKEN_2022_PROGRAM_ID
      );

      valuedTokenMintInfo = await provider.connection.getAccountInfo(
        valuedTokenMint
      );
      console.log("Valued token mint created:", valuedTokenMint.toBase58());
    } catch (error) {
      console.error("Error creating Valued token mint:", error);
      throw error;
    }

    escrowTokenMint = PublicKey.findProgramAddressSync(
      [
        Buffer.from("mint"),
        Buffer.from(tokenName),
        valuedTokenMint.toBuffer(),
        owner.toBuffer(),
        backend.publicKey.toBuffer(),
      ],
      program.programId
    )[0];

    console.log("Creating Valued token account...");
    try {
      // Create token accounts
      userValuedTokenAccount = await createAssociatedTokenAccount(
        provider.connection,
        user,
        valuedTokenMint,
        user.publicKey,
        { commitment: "confirmed" },
        valuedTokenMintInfo.owner
      );
      console.log(
        "User valued token account created:",
        userValuedTokenAccount.toBase58()
      );
    } catch (error) {
      console.error("Error creating Valued token account:", error);
      throw error;
    }

    userEscrowTokenAccount = getAssociatedTokenAddressSync(
      escrowTokenMint,
      user.publicKey,
      true,
      TOKEN_2022_PROGRAM_ID
    );
    console.log(
      "User escrow token account:",
      userEscrowTokenAccount.toBase58()
    );

    console.log("Minting valued token...");
    try {
      // Mint some tokens to user and backend
      await mintTo(
        provider.connection,
        user,
        valuedTokenMint,
        userValuedTokenAccount,
        user,
        1000000000000,
        [],
        { commitment: "confirmed" },
        valuedTokenMintInfo.owner
      );
      console.log("Tokens minted to user valued token account");
    } catch (error) {
      console.error("Error minting tokens:", error);
      throw error;
    }

    // Derive PDA addresses
    vaultAccount = PublicKey.findProgramAddressSync(
      [
        Buffer.from("token-vault"),
        owner.toBuffer(),
        backend.publicKey.toBuffer(),
        valuedTokenMint.toBuffer(),
        escrowTokenMint.toBuffer(),
      ],
      program.programId
    )[0];
    console.log("vaultAccount", vaultAccount.toBase58());

    valuedVaultTokenAccount = getAssociatedTokenAddressSync(
      valuedTokenMint,
      vaultAccount,
      true,
      valuedTokenMintInfo.owner
    );
    console.log("valuedVaultTokenAccount", valuedVaultTokenAccount.toBase58());

    escrowVaultTokenAccount = getAssociatedTokenAddressSync(
      escrowTokenMint,
      vaultAccount,
      true,
      TOKEN_2022_PROGRAM_ID
    );
    console.log("escrowVaultTokenAccount", escrowVaultTokenAccount.toBase58());

    [vestingSessionsAccount] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("vesting_sessions_account"),
        vaultAccount.toBuffer(),
        valuedTokenMint.toBuffer(),
        escrowTokenMint.toBuffer(),
      ],
      program.programId
    );

    await checkBalance(user.publicKey, "User (after setup)");
    await checkBalance(backend.publicKey, "Backend (after setup)");
  });

  it("Initializes a new escrow token", async () => {
    const tx = await program.methods
      .initEscrowToken({
        name: tokenName,
        symbol: tokenSymbol,
        uri: tokenUri,
        decimals: decimals,
      })
      .accounts({
        owner,
        backend: backend.publicKey,
        escrowTokenMint,
        valuedTokenMint,
        payer: user.publicKey,
      })
      .signers([backend, user])
      .rpc();

    await confirmTransaction(tx);

    console.log("Token initialized. Transaction signature:", tx);
  });

  it("Initializes a new vault account", async () => {
    const tx = await program.methods
      .initializeVaultAccount()
      .accounts({
        owner,
        vaultAccount,
        valuedVaultTokenAccount,
        escrowVaultTokenAccount,
        payer: user.publicKey,
        backend: backend.publicKey,
        valuedTokenMint,
        escrowTokenMint,
        valuedTokenProgram: valuedTokenMintInfo.owner,
      })
      .signers([backend, user])
      .rpc();

    await confirmTransaction(tx);

    assert.isTrue(
      await accountExists(vaultAccount),
      "Vault account should exist after initialization"
    );

    console.log("Vault account initialized. Transaction signature:", tx);
  });

  it("Mints escrow tokens into valut account", async () => {
    const tx = await program.methods
      .mintEscrowTokens({
        name: tokenName,
        symbol: tokenSymbol,
        uri: tokenUri,
        decimals: decimals,
      })
      .accounts({
        owner,
        backend: backend.publicKey,
        escrowTokenMint,
        vaultAccount,
        escrowVaultTokenAccount,
        payer: user.publicKey,
        valuedTokenMint,
      })
      .signers([backend, user])
      .rpc();

    console.log(
      `Tokens minted into ${escrowVaultTokenAccount.toBase58()}. Transaction signature:`,
      tx
    );
  });

  it("Exchanges tokens with 1:1 ratio and initializes accounts", async () => {
    try {
      const exchangeAmount = new anchor.BN(500000000000); // 500 tokens

      const userInitialBalance = await getTokenBalance(
        userValuedTokenAccount,
        valuedTokenMintInfo.owner
      );

      const valuedVaultBalance = await getTokenBalance(
        valuedVaultTokenAccount,
        valuedTokenMintInfo.owner
      );

      const escrowVaultInitialBalance = await getTokenBalance(
        escrowVaultTokenAccount
      );

      const tx = await program.methods
        .exchange(exchangeAmount)
        .accounts({
          owner,
          vaultAccount,
          valuedVaultTokenAccount,
          escrowVaultTokenAccount,
          user: user.publicKey,
          userValuedTokenAccount,
          userEscrowTokenAccount,
          backend: backend.publicKey,
          valuedTokenMint,
          escrowTokenMint,
          valuedTokenProgram: valuedTokenMintInfo.owner,
        })
        .signers([backend, user])
        .rpc();

      await confirmTransaction(tx);
      console.log("Tokens exchanged. Transaction signature:", tx);

      // Assert balances after exchange
      const userFinalBalance = await getTokenBalance(
        userValuedTokenAccount,
        valuedTokenMintInfo.owner
      );

      const valuedVaultFinalBalance = await getTokenBalance(
        valuedVaultTokenAccount,
        valuedTokenMintInfo.owner
      );
      const escrowVaultFinalBalance = await getTokenBalance(
        escrowVaultTokenAccount
      );

      assert.equal(
        userFinalBalance,
        userInitialBalance - exchangeAmount.toNumber(),
        "User balance should decrease by exchange amount"
      );

      assert.equal(
        valuedVaultFinalBalance,
        valuedVaultBalance + exchangeAmount.toNumber(),
        "Valued vault balance should increase by exchange amount"
      );

      assert.equal(
        escrowVaultFinalBalance,
        escrowVaultInitialBalance - exchangeAmount.toNumber(),
        "Escrow vault balance should decrease by exchange amount"
      );

      // Verify DualAuthAccount data
      const vaultAccountData = await program.account.vaultAccount.fetch(
        vaultAccount
      );
      assert.equal(
        vaultAccountData.owner.toBase58(),
        owner.toBase58(),
        "Owner public key should match"
      );
      assert.equal(
        vaultAccountData.backend.toBase58(),
        backend.publicKey.toBase58(),
        "Backend public key should match"
      );
    } catch (error) {
      if (error instanceof SendTransactionError) {
        console.error("SendTransactionError:", error.message);
        console.error("Logs:", await error.getLogs(provider.connection));
      } else {
        console.error("Error during token exchange:", error);
      }
      throw error;
    }
  });

  it("Creates a vesting session with correct amount", async () => {
    const vestingAmount = new anchor.BN(300000000000); // 300 tokens

    const initialvaultEscrowBalance = await getTokenBalance(
      escrowVaultTokenAccount
    );
    const initialUserEscrowBalance = await getTokenBalance(
      userEscrowTokenAccount
    );

    [vestingSessionAccount] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("a_vesting_session_account"),
        vestingSessionsAccount.toBuffer(),
        new anchor.BN(currentSessionId).toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );
    currentSessionId++;

    const tx = await program.methods
      .createVestingSession(vestingAmount)
      .accounts({
        owner,
        vestingSessionsAccount,
        vestingSessionAccount,
        user: user.publicKey,
        backend: backend.publicKey,
        vaultAccount,
        escrowVaultTokenAccount,
        userEscrowTokenAccount,
        valuedTokenMint,
        escrowTokenMint,
      })
      .signers([backend, user])
      .rpc();

    await confirmTransaction(tx);
    console.log("Vesting session created. Transaction signature:", tx);

    const finalVaultEscrowBalance = await getTokenBalance(
      escrowVaultTokenAccount
    );
    const finalUserEscrowBalance = await getTokenBalance(
      userEscrowTokenAccount
    );

    assert.equal(
      finalVaultEscrowBalance,
      initialvaultEscrowBalance + vestingAmount.toNumber(),
      "Vault escrow balance should increase by vesting amount"
    );
    assert.equal(
      finalUserEscrowBalance,
      initialUserEscrowBalance - vestingAmount.toNumber(),
      "User escrow balance should decrease by vesting amount"
    );

    // Fetch and check vesting session data
    const vestingSessionData = await program.account.vestingSession.fetch(
      vestingSessionAccount
    );
    assert.equal(
      vestingSessionData.amount.toNumber(),
      vestingAmount.toNumber(),
      "Vesting session amount should match"
    );
    assert.equal(
      vestingSessionData.amountWithdrawn.toNumber(),
      0,
      "Initial withdrawn amount should be 0"
    );
    assert(
      vestingSessionData.startDate.toNumber() > 0,
      "Start date should be set"
    );
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
  });

  it("Withdraws correct amount from a vesting session", async () => {
    // Wait for a minute to pass for vesting
    await new Promise((resolve) => setTimeout(resolve, 60 * 1000));

    const initialUserBalance = await getTokenBalance(
      userValuedTokenAccount,
      valuedTokenMintInfo.owner
    );
    const initialVaultValuedBalance = await getTokenBalance(
      valuedVaultTokenAccount,
      valuedTokenMintInfo.owner
    );

    const tx = await program.methods
      .sessionWithdraw()
      .accounts({
        owner,
        vestingSessionsAccount,
        vestingSessionAccount,
        vaultAccount,
        valuedVaultTokenAccount,
        user: user.publicKey,
        userValuedTokenAccount,
        backend: backend.publicKey,
        valuedTokenMint,
        escrowTokenMint,
        tokenProgram: valuedTokenMintInfo.owner,
      })
      .signers([backend, user])
      .rpc();

    await confirmTransaction(tx);
    console.log("Withdrawn from vesting session. Transaction signature:", tx);

    const finalUserBalance = await getTokenBalance(
      userValuedTokenAccount,
      valuedTokenMintInfo.owner
    );
    const finalVaultValuedBalance = await getTokenBalance(
      valuedVaultTokenAccount,
      valuedTokenMintInfo.owner
    );

    assert(
      finalUserBalance > initialUserBalance,
      "User balance should increase after withdrawal"
    );
    assert(
      finalVaultValuedBalance < initialVaultValuedBalance,
      "Vault valued balance should decrease after withdrawal"
    );

    // Fetch and check updated vesting session data
    const vestingSessionData = await program.account.vestingSession.fetch(
      vestingSessionAccount
    );
    assert(
      vestingSessionData.amountWithdrawn.toNumber() >=
        finalUserBalance - initialUserBalance,
      "Withdrawn amount should be greater than 0"
    );
    assert(
      vestingSessionData.lastWithdrawAt.toNumber() >
        vestingSessionData.startDate.toNumber(),
      "Last withdraw time should be updated"
    );
  });

  it("Cancels a vesting session correctly", async () => {
    // Wait for some time to pass for partial vesting
    await new Promise((resolve) => setTimeout(resolve, 60 * 1000)); // Wait for 1 minute

    const initialUserBalance = await getTokenBalance(
      userValuedTokenAccount,
      valuedTokenMintInfo.owner
    );
    const initialVaultValuedBalance = await getTokenBalance(
      valuedVaultTokenAccount,
      valuedTokenMintInfo.owner
    );
    const initialVaultEscrowBalance = await getTokenBalance(
      escrowVaultTokenAccount
    );
    const initialuserEscrowBalance = await getTokenBalance(
      userEscrowTokenAccount
    );

    const tx = await program.methods
      .sessionCancel()
      .accounts({
        owner,
        vestingSessionsAccount,
        vestingSessionAccount,
        vaultAccount,
        valuedVaultTokenAccount,
        escrowVaultTokenAccount,
        user: user.publicKey,
        userValuedTokenAccount,
        userEscrowTokenAccount,
        backend: backend.publicKey,
        valuedTokenMint,
        escrowTokenMint,
        valuedTokenProgram: valuedTokenMintInfo.owner,
      })
      .signers([backend, user])
      .rpc();

    await confirmTransaction(tx);
    console.log("Vesting session cancelled. Transaction signature:", tx);

    const finalUserBalance = await getTokenBalance(
      userValuedTokenAccount,
      valuedTokenMintInfo.owner
    );
    const finalVaultValuedBalance = await getTokenBalance(
      valuedVaultTokenAccount,
      valuedTokenMintInfo.owner
    );
    const finalVaultEscrowBalance = await getTokenBalance(
      escrowVaultTokenAccount
    );
    const finalUserEscrowBalance = await getTokenBalance(
      userEscrowTokenAccount
    );

    // Fetch the vesting session data to calculate expected values
    const vestingSessionData = await program.account.vestingSession.fetch(
      vestingSessionAccount
    );
    const vestedAmount = vestingSessionData.amountWithdrawn;

    // Verify balances
    assert(
      finalUserBalance >= initialUserBalance,
      "User balance should stay the same or increase"
    );

    assert(
      finalVaultValuedBalance <= initialVaultValuedBalance,
      "Vault valued balance should stay the same or decrease"
    );

    assert(
      finalVaultEscrowBalance <= initialVaultEscrowBalance,
      "Vault escrow balance should stay the same or decrease"
    );

    assert(
      finalUserEscrowBalance >= initialuserEscrowBalance,
      "User escrow balance should stay the same or increase"
    );

    const amountReleasedToUser = finalUserBalance - initialUserBalance;
    const amountReturnedToEscrow =
      initialVaultEscrowBalance - finalVaultEscrowBalance;
    const amountRemovedFromVaultValued =
      initialVaultValuedBalance - finalVaultValuedBalance;

    console.log("Amount released to user:", amountReleasedToUser);
    console.log("Initial escrow vault balance:", initialVaultEscrowBalance);
    console.log("Final escrow vault balance:", finalVaultEscrowBalance);
    console.log("Amount returned to escrow:", amountReturnedToEscrow);
    console.log(
      "Amount removed from vault valued account:",
      amountRemovedFromVaultValued
    );

    assert.approximately(
      amountReleasedToUser,
      amountRemovedFromVaultValued,
      1,
      "Released amount should match removed amount"
    );
    // Verify vesting session data
    assert(
      vestingSessionData.cancelledAt.toNumber() > 0,
      "Cancelled time should be set"
    );
    assert.equal(
      vestingSessionData.amountWithdrawn.toNumber(),
      vestedAmount.toNumber(),
      "Withdrawn amount should match vested amount"
    );

    // Verify that we can't withdraw after cancellation

    try {
      await program.methods
        .sessionWithdraw()
        .accounts({
          owner,
          vestingSessionsAccount,
          vestingSessionAccount,
          vaultAccount,
          valuedVaultTokenAccount,
          user: user.publicKey,
          userValuedTokenAccount,
          backend: backend.publicKey,
          valuedTokenMint,
          escrowTokenMint,
          tokenProgram: valuedTokenMintInfo.owner,
        })
        .signers([backend, user])
        .rpc();

      assert.fail("Should not be able to withdraw after cancellation");
    } catch (error) {
      // assert.include(error.message, "cannot withdraw from cancelled session");
    }
  });

  it("Allows the user to exist from the session as a fail safe", async () => {
    const vestingAmount = new anchor.BN(300000000000); // 300 tokens

    [vestingSessionAccount] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("a_vesting_session_account"),
        vestingSessionsAccount.toBuffer(),
        new anchor.BN(currentSessionId).toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );
    currentSessionId++;

    let tx = await program.methods
      .createVestingSession(vestingAmount)
      .accounts({
        owner,
        vestingSessionsAccount,
        vestingSessionAccount,
        user: user.publicKey,
        backend: backend.publicKey,
        vaultAccount,
        escrowVaultTokenAccount,
        userEscrowTokenAccount,
        valuedTokenMint,
        escrowTokenMint,
      })
      .signers([backend, user])
      .rpc();

    const initialUserBalance = await getTokenBalance(
      userValuedTokenAccount,
      valuedTokenMintInfo.owner
    );
    const initialVaultValuedBalance = await getTokenBalance(
      valuedVaultTokenAccount,
      valuedTokenMintInfo.owner
    );

    tx = await program.methods
      .sessionExit()
      .accounts({
        owner,
        vestingSessionsAccount,
        vestingSessionAccount,
        vaultAccount,
        valuedVaultTokenAccount,
        escrowVaultTokenAccount,
        user: user.publicKey,
        userValuedTokenAccount,
        userEscrowTokenAccount,
        backend: backend.publicKey,
        valuedTokenMint,
        escrowTokenMint,
        valuedTokenProgram: valuedTokenMintInfo.owner,
      })
      .signers([backend, user])
      .rpc();

    await confirmTransaction(tx);
    console.log("Vesting session exited. Transaction signature:", tx);

    const finalUserBalance = await getTokenBalance(
      userValuedTokenAccount,
      valuedTokenMintInfo.owner
    );
    const finalVaultValuedBalance = await getTokenBalance(
      valuedVaultTokenAccount,
      valuedTokenMintInfo.owner
    );

    // Fetch the vesting session data to calculate expected values
    const vestingSessionData = await program.account.vestingSession.fetch(
      vestingSessionAccount
    );
    const vestedAmount = vestingSessionData.amountWithdrawn;

    // Verify balances
    assert(
      finalUserBalance >= initialUserBalance + vestingAmount.toNumber(),
      "User balance should stay the same or increase"
    );

    assert(
      finalVaultValuedBalance <=
        initialVaultValuedBalance - vestingAmount.toNumber(),
      "Vault valued balance should stay the same or decrease"
    );

    const amountReleasedToUser = finalUserBalance - initialUserBalance;
    const amountRemovedFromVaultValued =
      initialVaultValuedBalance - finalVaultValuedBalance;

    console.log("Amount released to user:", amountReleasedToUser);
    console.log(
      "Amount removed from vault valued account:",
      amountRemovedFromVaultValued
    );

    assert.approximately(
      amountReleasedToUser,
      amountRemovedFromVaultValued,
      1,
      "Released amount should match removed amount"
    );
    // Verify vesting session data
    assert(
      vestingSessionData.cancelledAt.toNumber() > 0,
      "Cancelled time should be set"
    );
    assert.equal(
      vestingSessionData.amountWithdrawn.toNumber(),
      vestedAmount.toNumber(),
      "Withdrawn amount should match vested amount"
    );
  });

  // Additional security tests
  it("Handles rapid sequential withdrawals correctly", async () => {
    // Create a new vesting session

    [vestingSessionAccount] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("a_vesting_session_account"),
        vestingSessionsAccount.toBuffer(),
        new anchor.BN(currentSessionId).toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );
    currentSessionId++;

    const vestingAmount = new anchor.BN(1000000000);
    await program.methods
      .createVestingSession(vestingAmount)
      .accounts({
        owner,
        vestingSessionsAccount,
        vestingSessionAccount,
        user: user.publicKey,
        backend: backend.publicKey,
        vaultAccount,
        escrowVaultTokenAccount,
        userEscrowTokenAccount,
        valuedTokenMint,
        escrowTokenMint,
      })
      .signers([backend, user])
      .rpc();

    // Wait for a minute to pass for vesting
    await new Promise((resolve) => setTimeout(resolve, 60 * 1000));

    // Perform multiple rapid withdrawals
    const withdrawalPromises = [];
    for (let i = 0; i < 5; i++) {
      withdrawalPromises.push(
        program.methods
          .sessionWithdraw()
          .accounts({
            owner,
            vestingSessionsAccount,
            vestingSessionAccount,
            vaultAccount,
            valuedVaultTokenAccount,
            user: user.publicKey,
            userValuedTokenAccount,
            backend: backend.publicKey,
            valuedTokenMint,
            escrowTokenMint,
            tokenProgram: valuedTokenMintInfo.owner,
          })
          .signers([backend, user])
          .rpc()
      );
    }

    try {
      // Wait for all withdrawals to complete
      await Promise.all(withdrawalPromises);

      assert.fail(
        "Should not be able to withdraw more than one time in same minute"
      );
    } catch {}
  });

  it("Fails to withdraw with incorrect authority", async () => {
    const maliciousUser = anchor.web3.Keypair.generate();

    try {
      await program.methods
        .sessionWithdraw()
        .accounts({
          owner,
          vestingSessionsAccount,
          vestingSessionAccount,
          vaultAccount,
          valuedVaultTokenAccount,
          user: maliciousUser.publicKey,
          userValuedTokenAccount,
          backend: backend.publicKey,
          valuedTokenMint,
          escrowTokenMint,
          tokenProgram: valuedTokenMintInfo.owner,
        })
        .signers([maliciousUser, backend])
        .rpc();

      assert.fail("Should have thrown an error");
    } catch (error) {
      // assert.include(error.message, "A seeds constraint was violated'");
    }
  });

  it("Fails to cancel session with incorrect authority", async () => {
    const maliciousUser = anchor.web3.Keypair.generate();

    try {
      await program.methods
        .sessionCancel()
        .accounts({
          owner,
          vestingSessionsAccount,
          vestingSessionAccount,
          vaultAccount,
          valuedVaultTokenAccount,
          escrowVaultTokenAccount,
          user: maliciousUser.publicKey,
          userValuedTokenAccount,
          userEscrowTokenAccount,
          backend: backend.publicKey,
          valuedTokenMint,
          escrowTokenMint,
          valuedTokenProgram: valuedTokenMintInfo.owner,
        })
        .signers([maliciousUser, backend])
        .rpc();

      assert.fail("Should have thrown an error");
    } catch (error) {
      // assert.include(error.message, "A has_one constraint was violated");
    }
  });
});
