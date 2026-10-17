import { getPrisma } from "@sessionhub/database/client";
import { configurationProblem } from "@/server/env";
import { log } from "@/server/observability/logger";

export const dynamic = "force-dynamic";
let reported = false;

/** Readiness checks configuration and a bounded database query; never returns internals. */
export async function GET(): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  const problem = configurationProblem();
  if (problem) {
    if (!reported) {
      reported = true;
      log("error", "config_invalid", { detail: problem });
    }
    return Response.json({ status: "misconfigured" }, { status: 503, headers });
  }
  try {
    // Both pool acquisition and query execution must fit inside the container's 3 s probe.
    // A transaction also ensures PostgreSQL cancels the query; Promise.race alone would
    // leave abandoned work consuming pool connections on every subsequent probe.
    await getPrisma().$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL statement_timeout = '1000ms'`;
      await tx.$queryRaw`SELECT 1`;
    }, { maxWait: 1000, timeout: 1500 });
    return Response.json({ status: "ok" }, { headers });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503, headers });
  }
}
