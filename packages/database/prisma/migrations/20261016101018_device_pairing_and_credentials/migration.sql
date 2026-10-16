-- CreateEnum
CREATE TYPE "device_pairing_status" AS ENUM ('pending', 'approved', 'denied', 'redeemed');

-- CreateTable
CREATE TABLE "device_pairings" (
    "id" UUID NOT NULL,
    "device_code_hash" CHAR(64) NOT NULL,
    "user_code" VARCHAR(16) NOT NULL,
    "installation_id" UUID NOT NULL,
    "device_name" VARCHAR(120) NOT NULL,
    "browser" VARCHAR(40),
    "platform" VARCHAR(40),
    "status" "device_pairing_status" NOT NULL DEFAULT 'pending',
    "user_id" TEXT,
    "device_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "decided_at" TIMESTAMPTZ(3),
    "last_polled_at" TIMESTAMPTZ(3),

    CONSTRAINT "device_pairings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_credentials" (
    "id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "access_token_hash" CHAR(64) NOT NULL,
    "refresh_token_hash" CHAR(64) NOT NULL,
    "credential_version" INTEGER NOT NULL,
    "access_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "refresh_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "used_at" TIMESTAMPTZ(3),
    "rotated_at" TIMESTAMPTZ(3),
    "replaced_by_id" UUID,

    CONSTRAINT "device_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "device_pairings_device_code_hash_key" ON "device_pairings"("device_code_hash");

-- CreateIndex
CREATE UNIQUE INDEX "device_pairings_user_code_key" ON "device_pairings"("user_code");

-- CreateIndex
CREATE INDEX "device_pairings_expires_at_idx" ON "device_pairings"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "device_credentials_access_token_hash_key" ON "device_credentials"("access_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "device_credentials_refresh_token_hash_key" ON "device_credentials"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "device_credentials_device_id_idx" ON "device_credentials"("device_id");

-- CreateIndex
CREATE INDEX "device_credentials_refresh_expires_at_idx" ON "device_credentials"("refresh_expires_at");

-- AddForeignKey
ALTER TABLE "device_pairings" ADD CONSTRAINT "device_pairings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_credentials" ADD CONSTRAINT "device_credentials_device_id_user_id_fkey" FOREIGN KEY ("device_id", "user_id") REFERENCES "devices"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_credentials" ADD CONSTRAINT "device_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
