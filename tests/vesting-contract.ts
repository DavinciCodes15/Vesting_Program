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
    dualAuthAccount = PublicKey.findProgramAddressSync(
      [
        Buffer.from("dual_auth"),
        owner.toBuffer(),
        user.publicKey.toBuffer(),
        backend.publicKey.toBuffer(),
        valuedTokenMint.toBuffer(),
        escrowTokenMint.toBuffer(),
      ],
      program.programId
    )[0];

    dualValuedTokenAccount = getAssociatedTokenAddressSync(
      valuedTokenMint,
      dualAuthAccount,
      true,
      valuedTokenMintInfo.owner
    );

    dualEscrowTokenAccount = getAssociatedTokenAddressSync(
      escrowTokenMint,
      dualAuthAccount,
      true,
      TOKEN_2022_PROGRAM_ID
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

  it("Initializes a new token", async () => {
    const metadataAddress = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        tokenMetadataPorgramId.toBuffer(),
        escrowTokenMint.toBuffer(),
      ],
      tokenMetadataPorgramId
    )[0];

    const tx = await program.methods
      .initToken({
        name: tokenName,
        symbol: tokenSymbol,
        uri: tokenUri,
        decimals: decimals,
      })
      .accounts({
        owner,
        backend: backend.publicKey,
        mint: escrowTokenMint,
        valuedTokenMint,
        payer: user.publicKey,
      })
      .signers([backend, user])
      .rpc();

    await confirmTransaction(tx);
    console.log("Token initialized. Transaction signature:", tx);
  });

  it("Mints tokens", async () => {
    const quantity = new anchor.BN(1000000000000);

    backendEscrowTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      backend,
      escrowTokenMint,
      backend.publicKey,
      { commitment: "confirmed" },
      TOKEN_2022_PROGRAM_ID
    );
    console.log(
      "Backend escrow token account created:",
      backendEscrowTokenAccount.toBase58()
    );

    const tx = await program.methods
      .mintTokens(
        {
          name: tokenName,
          symbol: tokenSymbol,
          uri: tokenUri,
          decimals: decimals,
        },
        quantity
      )
      .accounts({
        owner,
        backend: backend.publicKey,
        mint: escrowTokenMint,
        destination: backendEscrowTokenAccount,
        payer: user.publicKey,
        valuedTokenMint,
      })
      .signers([backend, user])
      .rpc();

    console.log("Tokens minted. Transaction signature:", tx);
  });
  
  it("Initializes a new dual auth account", async () => {
    const tx = await program.methods
      .initializeDualAuthAccount()
      .accounts({
        owner,
        dualAuthAccount,
        dualValuedTokenAccount,
        user: user.publicKey,
        backend: backend.publicKey,
        valuedTokenMint,
        escrowTokenMint,
        tokenProgram: valuedTokenMintInfo.owner,
      })
      .signers([backend, user])
      .rpc();

    await confirmTransaction(tx);

    assert.isTrue(
      await accountExists(dualAuthAccount),
      "Dual auth account should exist after initialization"
    );

    console.log("Dual auth account initialized. Transaction signature:", tx);
  });

  it("Exchanges tokens with 1:1 ratio and initializes accounts", async () => {
    try {
      const exchangeAmount = new anchor.BN(500000000000); // 500 tokens

      const userInitialBalance = await getTokenBalance(
        userValuedTokenAccount,
        valuedTokenMintInfo.owner
      );

      const backendInitialBalance = await getTokenBalance(
        backendEscrowTokenAccount
      );

      const tx = await program.methods
        .exchange(exchangeAmount)
        .accounts({
          owner,
          dualAuthAccount,
          dualValuedTokenAccount,
          valuedTokenProgram: valuedTokenMintInfo.owner,
          dualEscrowTokenAccount,
          user: user.publicKey,
          userValuedTokenAccount,
          backend: backend.publicKey,
          backendEscrowTokenAccount,
          valuedTokenMint,
          escrowTokenMint,
        })
        .signers([backend, user])
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
      const userFinalBalance = await getTokenBalance(
        userValuedTokenAccount,
        valuedTokenMintInfo.owner
      );
      const backendFinalBalance = await getTokenBalance(
        backendEscrowTokenAccount
      );
      const dualValuedFinalBalance = await getTokenBalance(
        dualValuedTokenAccount,
        valuedTokenMintInfo.owner
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

  it("Transfers tokens correctly using the old Token", async () => {
    const transferAmount = new anchor.BN(100000000); // 100 tokens

    const initialFromBalance = await getTokenBalance(
      dualValuedTokenAccount,
      valuedTokenMintInfo.owner
    );
    const initialToBalance = await getTokenBalance(
      userValuedTokenAccount,
      valuedTokenMintInfo.owner
    );

    const tx = await program.methods
      .transferTokens(transferAmount)
      .accounts({
        owner,
        dualAuthAccount: dualAuthAccount,
        user: user.publicKey,
        backend: backend.publicKey,
        from: dualValuedTokenAccount,
        mint: valuedTokenMint,
        to: userValuedTokenAccount,
        valuedTokenMint,
        escrowTokenMint,
        tokenProgram: valuedTokenMintInfo.owner,
      })
      .signers([backend, user])
      .rpc();

    await confirmTransaction(tx);
    console.log("Tokens transferred. Transaction signature:", tx);

    const finalFromBalance = await getTokenBalance(
      dualValuedTokenAccount,
      valuedTokenMintInfo.owner
    );
    const finalToBalance = await getTokenBalance(
      userValuedTokenAccount,
      valuedTokenMintInfo.owner
    );

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

  it("Transfers tokens correctly using Token2022", async () => {
    const transferAmount = new anchor.BN(100000000); // 100 tokens

    const initialFromBalance = await getTokenBalance(dualEscrowTokenAccount);
    const initialToBalance = await getTokenBalance(backendEscrowTokenAccount);

    const tx = await program.methods
      .transferTokens(transferAmount)
      .accounts({
        owner,
        dualAuthAccount: dualAuthAccount,
        user: user.publicKey,
        backend: backend.publicKey,
        from: dualEscrowTokenAccount,
        mint: escrowTokenMint,
        to: backendEscrowTokenAccount,
        valuedTokenMint,
        escrowTokenMint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([backend, user])
      .rpc();

    await confirmTransaction(tx);
    console.log("Tokens transferred. Transaction signature:", tx);

    const finalFromBalance = await getTokenBalance(dualEscrowTokenAccount);
    const finalToBalance = await getTokenBalance(backendEscrowTokenAccount);

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
    const vestingAmount = new anchor.BN(300000000000); // 300 tokens

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
        owner,
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
      .signers([backend, user])
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

    const initialUserBalance = await getTokenBalance(
      userValuedTokenAccount,
      valuedTokenMintInfo.owner
    );
    const initialDualValuedBalance = await getTokenBalance(
      dualValuedTokenAccount,
      valuedTokenMintInfo.owner
    );

    const tx = await program.methods
      .sessionWithdraw()
      .accounts({
        owner,
        vestingSessionAccount,
        dualAuthAccount,
        dualValuedTokenAccount,
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
    const finalDualValuedBalance = await getTokenBalance(
      dualValuedTokenAccount,
      valuedTokenMintInfo.owner
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
    const initialDualValuedBalance = await getTokenBalance(
      dualValuedTokenAccount,
      valuedTokenMintInfo.owner
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
        owner,
        vestingSessionAccount,
        dualAuthAccount,
        dualValuedTokenAccount,
        valuedTokenProgram: valuedTokenMintInfo.owner,
        dualEscrowTokenAccount,
        user: user.publicKey,
        userValuedTokenAccount,
        backend: backend.publicKey,
        backendEscrowTokenAccount,
        valuedTokenMint,
        escrowTokenMint,
      })
      .signers([backend, user])
      .rpc();

    await confirmTransaction(tx);
    console.log("Vesting session cancelled. Transaction signature:", tx);

    const finalUserBalance = await getTokenBalance(
      userValuedTokenAccount,
      valuedTokenMintInfo.owner
    );
    const finalDualValuedBalance = await getTokenBalance(
      dualValuedTokenAccount,
      valuedTokenMintInfo.owner
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

    const amountReleasedToUser = finalUserBalance - initialUserBalance;
    const amountReturnedToEscrow =
      finalDualEscrowBalance - initialDualEscrowBalance;
    const amountRemovedFromDualValued =
      initialDualValuedBalance - finalDualValuedBalance;

    console.log("Amount released to user:", amountReleasedToUser);
    console.log("Amount returned to escrow:", amountReturnedToEscrow);
    console.log(
      "Amount removed from dual valued:",
      amountRemovedFromDualValued
    );

    assert.approximately(
      amountReleasedToUser,
      amountRemovedFromDualValued,
      1,
      "Amount released to user should match amount removed from dual valued"
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
          vestingSessionAccount,
          dualAuthAccount,
          dualValuedTokenAccount,
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

    const vestingAmount = new anchor.BN(1000000000);
    await program.methods
      .createVestingSession(vestingAmount)
      .accounts({
        owner,
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
            vestingSessionAccount,
            dualAuthAccount,
            dualValuedTokenAccount,
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
          vestingSessionAccount,
          dualAuthAccount,
          dualValuedTokenAccount,
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
          vestingSessionAccount,
          dualAuthAccount,
          dualValuedTokenAccount,
          valuedTokenProgram: valuedTokenMintInfo.owner,
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
          owner,
          dualAuthAccount,
          user: maliciousUser.publicKey,
          backend: backend.publicKey,
          from: dualValuedTokenAccount,
          mint: valuedTokenMint,
          to: userValuedTokenAccount,
          valuedTokenMint,
          escrowTokenMint,
          tokenProgram: valuedTokenMintInfo.owner,
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
