import { randomUUID } from "node:crypto";
import { API_LIMITS, createSessionRequestSchema } from "@sessionhub/contracts/api-sessions";
import { getPrisma } from "@sessionhub/database/client";
import { afterAll, describe, expect, it } from "vitest";
import { createSession } from "./sessions/mutations";
import { pushOperations } from "./sync/push";

const prisma = getPrisma();
afterAll(async () => {
  await prisma.$disconnect();
});

const body = () => createSessionRequestSchema.parse({ name: "One more", windows: [{ tabs: [{ url: "https://a.test/" }] }] });
const code = (promise: Promise<unknown>) => promise.then(() => "created", (error: { code?: string }) => error.code ?? String(error));

describe("resource limits", () => {
  it("caps live sessions per account, for web writes and sync uploads alike; deleted ones don't count", async () => {
    const user = await prisma.user.create({ data: { id: `user_${randomUUID()}`, name: "Hoarder", email: `${randomUUID()}@example.test` } });
    const device = await prisma.device.create({ data: { userId: user.id, installationId: randomUUID(), displayName: "Chrome" } });
    await prisma.savedSession.createMany({ data: Array.from({ length: API_LIMITS.sessionsPerAccountMax }, (_, index) => ({ userId: user.id, name: `S${index}` })) });

    expect(await code(createSession(prisma, user.id, body()))).toBe("LIMIT_REACHED");
    const [pushed] = await pushOperations(prisma, { userId: user.id, deviceId: device.id, deviceName: "Chrome" }, [
      { clientOperationId: randomUUID(), entityType: "savedSession", entityId: randomUUID(), action: "upsert", expectedVersion: 0, payload: { name: "Upload", windows: [{ tabs: [{ url: "https://a.test/" }] }] } },
    ]);
    expect(pushed).toMatchObject({ status: "rejected", code: "LIMIT_REACHED", replayed: false });

    const oldest = await prisma.savedSession.findFirstOrThrow({ where: { userId: user.id }, select: { id: true } });
    await prisma.savedSession.update({ where: { id: oldest.id }, data: { deletedAt: new Date() } });
    expect(await code(createSession(prisma, user.id, body()))).toBe("created");
    // Another account is unaffected all along.
    const other = await prisma.user.create({ data: { id: `user_${randomUUID()}`, name: "Other", email: `${randomUUID()}@example.test` } });
    expect(await code(createSession(prisma, other.id, body()))).toBe("created");
  });

  it("bounds every database statement and idle transaction", async () => {
    const [statement] = await prisma.$queryRaw<{ statement_timeout: string }[]>`SHOW statement_timeout`;
    const [idle] = await prisma.$queryRaw<{ idle_in_transaction_session_timeout: string }[]>`SHOW idle_in_transaction_session_timeout`;
    expect([statement?.statement_timeout, idle?.idle_in_transaction_session_timeout]).toEqual(["15s", "30s"]);
  });
});
