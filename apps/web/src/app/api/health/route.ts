import { configurationProblem } from "@/server/env";
import { log } from "@/server/observability/logger";

let reported = false;

/**
 * Health probe for Docker/Coolify. Answers 503 while the configuration is invalid (for example
 * BETTER_AUTH_URL without https in production), so such a deploy never takes traffic; the reason
 * is logged once, by variable name. Reports no internals. Doesn't check PostgreSQL.
 */
export function GET(): Response {
  const problem = configurationProblem();
  if (problem && !reported) {
    reported = true;
    log("error", "config_invalid", { detail: problem });
  }
  return Response.json({ status: problem ? "misconfigured" : "ok" }, { status: problem ? 503 : 200, headers: { "Cache-Control": "no-store" } });
}
