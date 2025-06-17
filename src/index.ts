import * as anchor from "@coral-xyz/anchor";
const { BN } = anchor.default;
import { clusterApiUrl, Connection, Keypair, PublicKey } from "@solana/web3.js";

import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
} from "@solana/spl-token";
import os from "os";

import MatoIDL from "./idl/mato.json" with { type: "json" };
import type { Mato } from "./types/mato.ts";

// process.env.ANCHOR_PROVIDER_URL = clusterApiUrl("devnet");
// process.env.ANCHOR_WALLET = os.homedir() + "/.config/solana/id.json";

const exits = new PublicKey("7fn18qWcZHXLGuwcb9vGJwLs6Vf6f3nZHBmjgNiJJPe1");
const prices = new PublicKey("BDRwP7699RGQ7Kj7gowNdh2wuscrcMjZLkaqh7x7tDSx");

let solMint = NATIVE_MINT;
let usdcMint = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

(async () => {
  const secretKeyArray = JSON.parse(process.env.ANCHOR_KEYPAIR || "");
  const secretKey = new Uint8Array(secretKeyArray);
  const keypair = Keypair.fromSecretKey(secretKey)
  const wallet = new anchor.Wallet(keypair)
  const connection = new Connection(process.env.ANCHOR_PROVIDER_URL || clusterApiUrl("devnet"))
  const provider = new anchor.AnchorProvider(connection, wallet)
  // const provider = anchor.AnchorProvider.env();
  const program = new anchor.Program(MatoIDL as Mato, provider);

  const [market] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), exits.toBuffer(), prices.toBuffer()],
    program.programId
  );

  const [bookkeeping] = PublicKey.findProgramAddressSync(
    [Buffer.from("bookkeeping"), market.toBuffer()],
    program.programId
  );

  const accounts: Record<string, PublicKey> = {
    tokenProgram: TOKEN_PROGRAM_ID,
    market: market,
    bookkeeping: bookkeeping,
    exits: exits,
    prices: prices,
  };

  while (true) {

    let currentSlot;
    let bookkeepingAccount;
    let allPositionsA;
    let allPositionsB;

    try {
      currentSlot = await provider.connection.getSlot();
      bookkeepingAccount =
        await program.account.bookkeeping.fetch(bookkeeping);

      allPositionsA = await program.account.positionA.all();
      allPositionsB = await program.account.positionB.all();
    } catch(e) {
      continue;
    }

    let slot = bookkeepingAccount.lastSlot.add(new BN(500));
    while (slot.toNumber() < currentSlot) {

      try {
        await program.methods
          .updateBookkeepingTill(slot)
          .accountsPartial({ ...accounts })
          .rpc({ skipPreflight: true });
      } catch (e) {
        console.log("Error updating books", e);
      }

      try {
        bookkeepingAccount =
          await program.account.bookkeeping.fetch(bookkeeping);
      } catch (e) {
        console.log("Error fetching bookkeeping account:", e);
      }

      slot = bookkeepingAccount.lastSlot.add(new BN(500));
    }

    allPositionsA.forEach(async (position) => {
      if (position.account.endSlot.toNumber() < currentSlot) {
        const [positionAPda] = PublicKey.findProgramAddressSync(
          [
            Buffer.from("position_a"),
            market.toBuffer(),
            position.account.owner.toBuffer(),
            position.account.id.toArrayLike(Buffer, "le", 8),
          ],
          program.programId
        );

        let solATA = getAssociatedTokenAddressSync(
          solMint,
          position.account.owner
        );

        let usdcATA = getAssociatedTokenAddressSync(
          usdcMint,
          position.account.owner
        );

      try{
        await program.methods
          .publicClosePositionA()
          .accountsPartial({
            signer: provider.publicKey,
            positionOwner: position.account.owner,
            ownerTokenAccountA: solATA,
            ownerTokenAccountB: usdcATA,
            tokenMintA: solMint,
            tokenMintB: usdcMint,
            market: market,
            positionA: positionAPda,
            bookkeeping: bookkeeping,
            exits: exits,
            prices: prices,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc({ skipPreflight: true });

          await new Promise((f) => setTimeout(f, 100));
        } catch (e) {
          console.log("Error closing positions a:", e);
        }
      }
    });

    allPositionsB.forEach(async (position) => {
      if (position.account.endSlot.toNumber() < currentSlot) {
        const [positionBPda] = PublicKey.findProgramAddressSync(
          [
            Buffer.from("position_b"),
            market.toBuffer(),
            position.account.owner.toBuffer(),
            position.account.id.toArrayLike(Buffer, "le", 8),
          ],
          program.programId
        );

        let solATA = getAssociatedTokenAddressSync(
          solMint,
          position.account.owner
        );

        let usdcATA = getAssociatedTokenAddressSync(
          usdcMint,
          position.account.owner
        );

        try {
        await program.methods
          .publicClosePositionB()
          .accountsPartial({
            signer: provider.publicKey,
            positionOwner: position.account.owner,
            ownerTokenAccountA: solATA,
            ownerTokenAccountB: usdcATA,
            tokenMintA: solMint,
            tokenMintB: usdcMint,
            market: market,
            positionB: positionBPda,
            bookkeeping: bookkeeping,
            exits: exits,
            prices: prices,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc({ skipPreflight: true });

          await new Promise((f) => setTimeout(f, 100));
        } catch (e) {
          console.log("Error closing positions b:", e);
        }
      }
    });

    await new Promise((f) => setTimeout(f, 4000));
  }
})()
  .then(() => console.log("Books updated!"))
  .catch((e) => console.log(e));
