-- CreateTable
CREATE TABLE "rate_limit_buckets" (
    "key" VARCHAR(255) NOT NULL,
    "tokens" DOUBLE PRECISION NOT NULL,
    "allowed" BOOLEAN NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "rate_limit_buckets_updated_at_idx" ON "rate_limit_buckets"("updated_at");
