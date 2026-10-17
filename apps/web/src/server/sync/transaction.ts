import type { Prisma, PrismaClient } from "@sessionhub/database/client";
import { RollbackWith } from "../service-errors";

export type Tx = Prisma.TransactionClient;

/**
 * Runs one mutation in one transaction (docs/SYNC_PROTOCOL.md section 8). Throwing
 * RollbackWith returns a value while rolling back, so replays consume no sequence number.
 */
export const runMutation = async <T>(prisma: PrismaClient, fn: (tx: Tx) => Promise<T>): Promise<T> => {
  try {
    return await prisma.$transaction(fn, { timeout: 20_000, maxWait: 10_000 });
  } catch (error) {
    if (error instanceof RollbackWith) return error.value as T;
    throw error;
  }
};

/**
 * Locks the user's sync clock row (creating it on first use) and returns the next sequence.
 * Taken FIRST in every mutation, so one user's writes are serialized in commit order: pulls
 * can't skip a change, version checks can't race, and the fixed lock order can't deadlock.
 */
export const nextSequence = async (tx: Tx, userId: string): Promise<bigint> => {
  const rows = await tx.$queryRaw<{ last_sequence: bigint }[]>`
    INSERT INTO "user_sync_clocks" ("user_id", "last_sequence") VALUES (${userId}, 1)
    ON CONFLICT ("user_id") DO UPDATE SET "last_sequence" = "user_sync_clocks"."last_sequence" + 1
    RETURNING "last_sequence"`;
  const sequence = rows[0]?.last_sequence;
  if (sequence === undefined) throw new Error("Sync clock update returned no row");
  return BigInt(sequence);
};
