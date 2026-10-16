/**
 * Liveness probe for Docker/Coolify. Reports no internals. A readiness check that
 * includes PostgreSQL arrives with the database in M3.
 */
export function GET(): Response {
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
