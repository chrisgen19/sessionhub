-- Tags on saved sessions (docs/DATA_MODEL.md, SavedSession).
-- Additive: existing rows get an empty list from the default, so nothing changes for them.
-- AlterTable
ALTER TABLE "saved_sessions" ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
