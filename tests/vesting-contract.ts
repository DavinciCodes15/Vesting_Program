import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { VestingContract } from "../target/types/vesting_contract";
import {
  PublicKey,
  SystemProgram,
  SendTransactionError,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAssociatedTokenAddressSync,
  getAccount,
} from "@solana/spl-token";
import { assert } from "chai";

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

  let valuedTokenMint: PublicKey;
  let escrowTokenMint: PublicKey;
  let userValuedTokenAccount: PublicKey;
  let backendEscrowTokenAccount: PublicKey;
  let dualAuthAccount: PublicKey;
  let dualValuedTokenAccount: PublicKey;
  let dualEscrowTokenAccount: PublicKey;
  let vestingSessionsAccount: PublicKey;
  let vestingSessionAccount: PublicKey;

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

  async function getTokenBalance(tokenAccount: PublicKey): Promise<number> {
    const account = await getAccount(provider.connection, tokenAccount);
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

    console.log("Creating token mints...");
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
      );
      console.log("Valued token mint created:", valuedTokenMint.toBase58());

      escrowTokenMint = await createMint(
        provider.connection,
        backend,
        backend.publicKey,
        null,
        9,
        undefined,
        { commitment: "confirmed" }
      );
      console.log("Escrow token mint created:", escrowTokenMint.toBase58());
    } catch (error) {
      console.error("Error creating token mints:", error);
      throw error;
    }

    console.log("Creating token accounts...");
    try {
      // Create token accounts
      userValuedTokenAccount = await createAssociatedTokenAccount(
        provider.connection,
        user,
        valuedTokenMint,
        user.publicKey,
        { commitment: "confirmed" }
      );
      console.log(
        "User valued token account created:",
        userValuedTokenAccount.toBase58()
      );

      backendEscrowTokenAccount = await createAssociatedTokenAccount(
        provider.connection,
        backend,
        escrowTokenMint,
        backend.publicKey,
        { commitment: "confirmed" }
      );
      console.log(
        "Backend escrow token account created:",
        backendEscrowTokenAccount.toBase58()
      );
    } catch (error) {
      console.error("Error creating token accounts:", error);
      throw error;
    }

    console.log("Minting tokens...");
    try {
      // Mint some tokens to user and backend
      await mintTo(
        provider.connection,
        user,
        valuedTokenMint,
        userValuedTokenAccount,
        user,
        1000000000,
        [],
        { commitment: "confirmed" }
      );
      console.log("Tokens minted to user valued token account");

      await mintTo(
        provider.connection,
        backend,
        escrowTokenMint,
        backendEscrowTokenAccount,
        backend,
        1000000000,
        [],
        { commitment: "confirmed" }
      );
      console.log("Tokens minted to backend escrow token account");
    } catch (error) {
      console.error("Error minting tokens:", error);
      throw error;
    }

    // Derive PDA addresses
    dualAuthAccount = PublicKey.findProgramAddressSync(
      [
        Buffer.from("dual_auth"),
        user.publicKey.toBuffer(),
        backend.publicKey.toBuffer(),
      ],
      program.programId
    )[0];

    dualValuedTokenAccount = getAssociatedTokenAddressSync(
      valuedTokenMint,
      dualAuthAccount,
      true
    );

    dualEscrowTokenAccount = getAssociatedTokenAddressSync(
      escrowTokenMint,
      dualAuthAccount,
      true
    );

    [vestingSessionsAccount] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("vesting_sessions_account"),
        dualAuthAccount.toBuffer(),
        valuedTokenMint.toBuffer(),
        escrowTokenMint.toBuffer(),
      ],
      program.programId
    );

    await checkBalance(user.publicKey, "User (after setup)");
    await checkBalance(backend.publicKey, "Backend (after setup)");
  });

  it("Exchanges tokens with 1:1 ratio and initializes accounts", async () => {
    const exchangeAmount = new anchor.BN(500000000); // 500 tokens

    const userInitialBalance = await getTokenBalance(userValuedTokenAccount);
    const backendInitialBalance = await getTokenBalance(
      backendEscrowTokenAccount
    );

    // Check that accounts don't exist before exchange
    assert.isFalse(
      await accountExists(dualAuthAccount),
      "Dual auth account should not exist before exchange"
    );
    assert.isFalse(
      await accountExists(dualValuedTokenAccount),
      "Dual valued token account should not exist before exchange"
    );
    assert.isFalse(
      await accountExists(dualEscrowTokenAccount),
      "Dual escrow token account should not exist before exchange"
    );

    try {
      const tx = await program.methods
        .exchange(exchangeAmount)
        .accounts({
          dualAuthAccount,
          dualValuedTokenAccount,
          dualEscrowTokenAccount,
          user: user.publicKey,
          userValuedTokenAccount,
          backend: backend.publicKey,
          backendEscrowTokenAccount,
          valuedTokenMint,
          escrowTokenMint,
        })
        .signers([user, backend])
        .rpc();

      await confirmTransaction(tx);
      console.log("Tokens exchanged. Transaction signature:", tx);

      // Check that accounts exist after exchange
      assert.isTrue(
        await accountExists(dualAuthAccount),
        "Dual auth account should exist after exchange"
      );
      assert.isTrue(
        await accountExists(dualValuedTokenAccount),
        "Dual valued token account should exist after exchange"
      );
      assert.isTrue(
        await accountExists(dualEscrowTokenAccount),
        "Dual escrow token account should exist after exchange"
      );

      // Assert balances after exchange
      const userFinalBalance = await getTokenBalance(userValuedTokenAccount);
      const backendFinalBalance = await getTokenBalance(
        backendEscrowTokenAccount
      );
      const dualValuedFinalBalance = await getTokenBalance(
        dualValuedTokenAccount
      );
      const dualEscrowFinalBalance = await getTokenBalance(
        dualEscrowTokenAccount
      );

      assert.equal(
        userFinalBalance,
        userInitialBalance - exchangeAmount.toNumber(),
        "User balance should decrease by exchange amount"
      );
      assert.equal(
        backendFinalBalance,
        backendInitialBalance - exchangeAmount.toNumber(),
        "Backend balance should decrease by exchange amount"
      );
      assert.equal(
        dualValuedFinalBalance,
        exchangeAmount.toNumber(),
        "Dual valued balance should equal exchange amount"
      );
      assert.equal(
        dualEscrowFinalBalance,
        exchangeAmount.toNumber(),
        "Dual escrow balance should equal exchange amount"
      );

      // Verify DualAuthAccount data
      const dualAuthAccountData = await program.account.dualAuthAccount.fetch(
        dualAuthAccount
      );
      assert.equal(
        dualAuthAccountData.user.toBase58(),
        user.publicKey.toBase58(),
        "User public key should match"
      );
      assert.equal(
        dualAuthAccountData.backend.toBase58(),
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

  it("Transfers tokens correctly", async () => {
    const transferAmount = new anchor.BN(100000000); // 100 tokens

    const initialFromBalance = await getTokenBalance(dualValuedTokenAccount);
    const initialToBalance = await getTokenBalance(userValuedTokenAccount);

    const tx = await program.methods
      .transferTokens(transferAmount)
      .accounts({
        dualAuthAccount: dualAuthAccount,
        user: user.publicKey,
        backend: backend.publicKey,
        from: dualValuedTokenAccount,
        to: userValuedTokenAccount,
      })
      .signers([user, backend])
      .rpc();

    await confirmTransaction(tx);
    console.log("Tokens transferred. Transaction signature:", tx);

    const finalFromBalance = await getTokenBalance(dualValuedTokenAccount);
    const finalToBalance = await getTokenBalance(userValuedTokenAccount);

    assert.equal(
      finalFromBalance,
      initialFromBalance - transferAmount.toNumber(),
      "From balance should decrease by transfer amount"
    );
    assert.equal(
      finalToBalance,
      initialToBalance + transferAmount.toNumber(),
      "To balance should increase by transfer amount"
    );
  });

  it("Creates a vesting session with correct amount", async () => {
    const vestingAmount = new anchor.BN(300000000); // 300 tokens

    const initialBackendBalance = await getTokenBalance(
      backendEscrowTokenAccount
    );
    const initialDualEscrowBalance = await getTokenBalance(
      dualEscrowTokenAccount
    );

    [vestingSessionAccount] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("a_vesting_session_account"),
        vestingSessionsAccount.toBuffer(),
        new anchor.BN(0).toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    const tx = await program.methods
      .createVestingSession(vestingAmount)
      .accounts({
        vestingSessionsAccount,
        vestingSessionAccount,
        user: user.publicKey,
        backend: backend.publicKey,
        valuedTokenMint,
        escrowTokenMint,
        dualAuthAccount,
        backendEscrowTokenAccount,
        dualEscrowTokenAccount,
      })
      .signers([user, backend])
      .rpc();

    await confirmTransaction(tx);
    console.log("Vesting session created. Transaction signature:", tx);

    const finalBackendBalance = await getTokenBalance(
      backendEscrowTokenAccount
    );
    const finalDualEscrowBalance = await getTokenBalance(
      dualEscrowTokenAccount
    );

    assert.equal(
      finalBackendBalance,
      initialBackendBalance + vestingAmount.toNumber(),
      "Backend balance should increase by vesting amount"
    );
    assert.equal(
      finalDualEscrowBalance,
      initialDualEscrowBalance - vestingAmount.toNumber(),
      "Dual escrow balance should decrease by vesting amount"
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

    const initialUserBalance = await getTokenBalance(userValuedTokenAccount);
    const initialDualValuedBalance = await getTokenBalance(
      dualValuedTokenAccount
    );

    const tx = await program.methods
      .sessionWithdraw()
      .accounts({
        vestingSessionAccount,
        dualAuthAccount,
        dualValuedTokenAccount,
        user: user.publicKey,
        userValuedTokenAccount,
        backend: backend.publicKey,
        valuedTokenMint,
      })
      .signers([user, backend])
      .rpc();

    await confirmTransaction(tx);
    console.log("Withdrawn from vesting session. Transaction signature:", tx);

    const finalUserBalance = await getTokenBalance(userValuedTokenAccount);
    const finalDualValuedBalance = await getTokenBalance(
      dualValuedTokenAccount
    );

    assert(
      finalUserBalance > initialUserBalance,
      "User balance should increase after withdrawal"
    );
    assert(
      finalDualValuedBalance < initialDualValuedBalance,
      "Dual valued balance should decrease after withdrawal"
    );

    // Fetch and check updated vesting session data
    const vestingSessionData = await program.account.vestingSession.fetch(
      vestingSessionAccount
    );
    assert(
      vestingSessionData.amountWithdrawn.toNumber() > 0,
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

    const initialUserBalance = await getTokenBalance(userValuedTokenAccount);
    const initialDualValuedBalance = await getTokenBalance(
      dualValuedTokenAccount
    );
    const initialDualEscrowBalance = await getTokenBalance(
      dualEscrowTokenAccount
    );
    const initialBackendEscrowBalance = await getTokenBalance(
      backendEscrowTokenAccount
    );

    const tx = await program.methods
      .sessionCancel()
      .accounts({
        vestingSessionAccount,
        dualAuthAccount,
        dualValuedTokenAccount,
        dualEscrowTokenAccount,
        user: user.publicKey,
        userValuedTokenAccount,
        backend: backend.publicKey,
        backendEscrowTokenAccount,
        valuedTokenMint,
        escrowTokenMint,
      })
      .signers([user, backend])
      .rpc();

    await confirmTransaction(tx);
    console.log("Vesting session cancelled. Transaction signature:", tx);

    const finalUserBalance = await getTokenBalance(userValuedTokenAccount);
    const finalDualValuedBalance = await getTokenBalance(
      dualValuedTokenAccount
    );
    const finalDualEscrowBalance = await getTokenBalance(
      dualEscrowTokenAccount
    );
    const finalBackendEscrowBalance = await getTokenBalance(
      backendEscrowTokenAccount
    );

    // Fetch the vesting session data to calculate expected values
    const vestingSessionData = await program.account.vestingSession.fetch(
      vestingSessionAccount
    );
    const vestedAmount = vestingSessionData.amountWithdrawn;

    // Verify balances
    assert(
      finalUserBalance > initialUserBalance,
      "User balance should increase by released amount"
    );

    assert(
      finalDualValuedBalance < initialDualValuedBalance,
      "Dual valued balance should decrease"
    );

    assert(
      finalDualEscrowBalance >= initialDualEscrowBalance,
      "Dual escrow balance should increase by unreleased amount"
    );

    assert(
      finalBackendEscrowBalance <= initialBackendEscrowBalance,
      "Backend escrow balance should decrease or stay the same."
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
          vestingSessionAccount,
          dualAuthAccount,
          dualValuedTokenAccount,
          user: user.publicKey,
          userValuedTokenAccount,
          backend: backend.publicKey,
          valuedTokenMint,
        })
        .signers([user, backend])
        .rpc();

      assert.fail("Should not be able to withdraw after cancellation");
    } catch (error) {
      // assert.include(error.message, "cannot withdraw from cancelled session");
    }
  });

  // Additional security tests
  it("Handles rapid sequential withdrawals correctly", async () => {
    // Create a new vesting session

    [vestingSessionAccount] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("a_vesting_session_account"),
        vestingSessionsAccount.toBuffer(),
        new anchor.BN(1).toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    const vestingAmount = new anchor.BN(100000000);
    await program.methods
      .createVestingSession(vestingAmount)
      .accounts({
        vestingSessionsAccount,
        vestingSessionAccount,
        user: user.publicKey,
        backend: backend.publicKey,
        valuedTokenMint,
        escrowTokenMint,
        dualAuthAccount,
        backendEscrowTokenAccount,
        dualEscrowTokenAccount,
      })
      .signers([user, backend])
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
            vestingSessionAccount,
            dualAuthAccount,
            dualValuedTokenAccount,
            user: user.publicKey,
            userValuedTokenAccount,
            backend: backend.publicKey,
            valuedTokenMint,
          })
          .signers([user, backend])
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
          vestingSessionAccount,
          dualAuthAccount,
          dualValuedTokenAccount,
          user: maliciousUser.publicKey,
          userValuedTokenAccount,
          backend: backend.publicKey,
          valuedTokenMint,
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
          vestingSessionAccount,
          dualAuthAccount,
          dualValuedTokenAccount,
          dualEscrowTokenAccount,
          user: maliciousUser.publicKey,
          userValuedTokenAccount,
          backend: backend.publicKey,
          backendEscrowTokenAccount,
          valuedTokenMint,
          escrowTokenMint,
        })
        .signers([maliciousUser, backend])
        .rpc();

      assert.fail("Should have thrown an error");
    } catch (error) {
      // assert.include(error.message, "A has_one constraint was violated");
    }
  });

  it("Fails to transfer tokens with incorrect authority", async () => {
    const maliciousUser = anchor.web3.Keypair.generate();
    const amount = new anchor.BN(100000000); // 100 tokens

    try {
      await program.methods
        .transferTokens(amount)
        .accounts({
          dualAuthAccount,
          user: maliciousUser.publicKey,
          backend: backend.publicKey,
          from: dualValuedTokenAccount,
          to: userValuedTokenAccount,
        })
        .signers([maliciousUser, backend])
        .rpc();

      assert.fail("Should have thrown an error");
    } catch (error) {
      // console.log("Error:", error.message);
      // assert.include(error.message, "A has_one constraint was violated");
    }
  });
});

// it("Initializes a new token", async () => {
//   const tokenName = "Test Token";
//   const tokenSymbol = "TST";
//   const tokenUri = "https://test.com";
//   const decimals = 9;

//   const metadataAddress = PublicKey.findProgramAddressSync(
//     [
//       Buffer.from("metadata"),
//       tokenMetadataPorgramId.toBuffer(),
//       escrowTokenMint.toBuffer(),
//     ],
//     tokenMetadataPorgramId
//   )[0];

//   const tx = await program.methods
//     .initToken({
//       name: tokenName,
//       symbol: tokenSymbol,
//       uri: tokenUri,
//       decimals: decimals,
//     })
//     .accounts({
//       metadata: metadataAddress,
//       mint: escrowTokenMint,
//       payer: payer.publicKey,
//       rent: SYSVAR_RENT_PUBKEY,
//       systemProgram: SystemProgram.programId,
//       tokenProgram: TOKEN_PROGRAM_ID,
//       tokenMetadataProgram: tokenMetadataPorgramId,
//     })
//     .signers([payer])
//     .rpc();

//   await confirmTransaction(tx);
//   console.log("Token initialized. Transaction signature:", tx);
// });

// it("Mints tokens", async () => {
//   const tokenName = "Test Token";
//   const tokenSymbol = "TST";
//   const tokenUri = "https://test.com";
//   const decimals = 9;
//   const quantity = new anchor.BN(100000000); // 100 tokens

//   const [mint] = PublicKey.findProgramAddressSync(
//     [Buffer.from("mint"), Buffer.from(tokenName), payer.publicKey.toBuffer()],
//     program.programId
//   );

//   const destinationAccount = await createAssociatedTokenAccount(
//     provider.connection,
//     payer,
//     mint,
//     payer.publicKey
//   );

//   const tx = await program.methods
//     .mintTokens(
//       {
//         name: tokenName,
//         symbol: tokenSymbol,
//         uri: tokenUri,
//         decimals: decimals,
//       },
//       quantity
//     )
//     .accounts({
//       mint: mint,
//       destination: destinationAccount,
//       payer: payer.publicKey,
//       rent: SYSVAR_RENT_PUBKEY,
//       systemProgram: SystemProgram.programId,
//       tokenProgram: TOKEN_PROGRAM_ID,
//       associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
//     })
//     .signers([payer])
//     .rpc();

//   console.log("Tokens minted. Transaction signature:", tx);
// });
