-- Window size, position and state for saved sessions (docs/DATA_MODEL.md, SavedSessionWindow).
-- Additive and nullable: existing rows keep NULL ("unknown"), so nothing changes for them.

-- CreateEnum
CREATE TYPE "window_state" AS ENUM ('normal', 'maximized', 'fullscreen');

-- AlterTable
ALTER TABLE "saved_session_windows" ADD COLUMN     "bounds_height" INTEGER,
ADD COLUMN     "bounds_left" INTEGER,
ADD COLUMN     "bounds_top" INTEGER,
ADD COLUMN     "bounds_width" INTEGER,
ADD COLUMN     "state" "window_state";
