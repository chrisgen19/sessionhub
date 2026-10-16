import { z } from "zod";
import { SessionServiceError } from "./errors";

const cursorSchema = z.tuple([z.iso.datetime(), z.uuid()]);

/** Opaque keyset cursor over (updatedAt desc, id desc). Not an authorization token: queries stay user-scoped. */
export const encodeCursor = (updatedAt: Date, id: string): string =>
  Buffer.from(JSON.stringify([updatedAt.toISOString(), id])).toString("base64url");

export const decodeCursor = (cursor: string): { updatedAt: Date; id: string } => {
  try {
    const [updatedAt, id] = cursorSchema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
    return { updatedAt: new Date(updatedAt), id };
  } catch {
    throw new SessionServiceError("INVALID_CURSOR", "That page cursor isn't valid. Start again from the first page.");
  }
};
