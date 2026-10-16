/**
 * Origin of the SessionHub server, fixed at build time (WXT_API_BASE_URL, validated in
 * wxt.config.ts, which also grants host access to exactly this origin).
 */
export const API_ORIGIN = new URL(import.meta.env.WXT_API_BASE_URL || "http://localhost:3000").origin;
