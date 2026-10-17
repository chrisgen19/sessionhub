import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/server/auth";

// Better Auth's endpoints (/api/auth/*). Resolved per request so builds need no secrets.
const handlers = () => toNextJsHandler(getAuth());

export const GET = (request: Request) => handlers().GET(request);
export const POST = (request: Request) => handlers().POST(request);
