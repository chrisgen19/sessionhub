import { z } from "zod";
import { SESSION_SCHEMA_VERSION, savedSessionSchema } from "./session";

export const SESSION_EXPORT_FORMAT = "sessionhub.session-export";

/** Versioned single-session export file (docs/DATA_MODEL.md section 5). */
export const sessionExportSchema = z.object({
  format: z.literal(SESSION_EXPORT_FORMAT),
  schemaVersion: z.literal(SESSION_SCHEMA_VERSION),
  exportedAt: z.iso.datetime(),
  session: savedSessionSchema,
});
export type SessionExport = z.infer<typeof sessionExportSchema>;
