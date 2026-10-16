-- CreateEnum
CREATE TYPE "tab_group_color" AS ENUM ('grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange');

-- CreateEnum
CREATE TYPE "restore_eligibility" AS ENUM ('restorable', 'browser_internal', 'local_file', 'unsafe', 'unsupported', 'invalid');

-- CreateEnum
CREATE TYPE "sync_entity_type" AS ENUM ('workspace', 'saved_session');

-- CreateEnum
CREATE TYPE "sync_change_kind" AS ENUM ('upsert', 'delete');

-- CreateEnum
CREATE TYPE "sync_operation_result" AS ENUM ('accepted', 'conflict', 'rejected');

-- CreateEnum
CREATE TYPE "audit_event_kind" AS ENUM ('sign_in', 'device_paired', 'device_revoked', 'account_deletion_requested', 'data_exported');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "installation_id" UUID NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "browser" VARCHAR(40),
    "platform" VARCHAR(40),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "auth_credential_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspaces" (
    "id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(1000),
    "icon" VARCHAR(40),
    "color" VARCHAR(20),
    "position" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_sessions" (
    "id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "workspace_id" UUID,
    "source_device_id" UUID,
    "source_device_name" VARCHAR(120) NOT NULL DEFAULT '',
    "name" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000),
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "tab_count" INTEGER NOT NULL DEFAULT 0,
    "window_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "last_restored_at" TIMESTAMPTZ(3),

    CONSTRAINT "saved_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_session_windows" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "label" VARCHAR(120),

    CONSTRAINT "saved_session_windows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_session_groups" (
    "id" UUID NOT NULL,
    "window_id" UUID NOT NULL,
    "title" VARCHAR(256) NOT NULL DEFAULT '',
    "color" "tab_group_color" NOT NULL DEFAULT 'grey',
    "collapsed" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "saved_session_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_session_tabs" (
    "id" UUID NOT NULL,
    "window_id" UUID NOT NULL,
    "group_id" UUID,
    "title" VARCHAR(1024) NOT NULL DEFAULT '',
    "url" VARCHAR(8192) NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL,
    "eligibility" "restore_eligibility" NOT NULL,

    CONSTRAINT "saved_session_tabs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_versions" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "checksum" VARCHAR(128) NOT NULL,
    "author_device_id" UUID,
    "operation_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sync_clocks" (
    "user_id" TEXT NOT NULL,
    "last_sequence" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "user_sync_clocks_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "sync_changes" (
    "id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "sequence" BIGINT NOT NULL,
    "entity_type" "sync_entity_type" NOT NULL,
    "entity_id" UUID NOT NULL,
    "change_kind" "sync_change_kind" NOT NULL,
    "entity_version" INTEGER NOT NULL,
    "payload" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_operation_receipts" (
    "user_id" TEXT NOT NULL,
    "device_id" UUID NOT NULL,
    "client_operation_id" UUID NOT NULL,
    "result_status" "sync_operation_result" NOT NULL,
    "result_payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_operation_receipts_pkey" PRIMARY KEY ("user_id","device_id","client_operation_id")
);

-- CreateTable
CREATE TABLE "user_settings" (
    "user_id" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "sync_enabled_at" TIMESTAMPTZ(3),
    "preferences" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" "audit_event_kind" NOT NULL,
    "device_id" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "account"("userId");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

-- CreateIndex
CREATE INDEX "devices_user_id_idx" ON "devices"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "devices_user_id_installation_id_key" ON "devices"("user_id", "installation_id");

-- CreateIndex
CREATE UNIQUE INDEX "devices_id_user_id_key" ON "devices"("id", "user_id");

-- CreateIndex
CREATE INDEX "workspaces_user_id_updated_at_idx" ON "workspaces"("user_id", "updated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_id_user_id_key" ON "workspaces"("id", "user_id");

-- CreateIndex
CREATE INDEX "saved_sessions_user_id_updated_at_id_idx" ON "saved_sessions"("user_id", "updated_at" DESC, "id");

-- CreateIndex
CREATE INDEX "saved_sessions_user_id_workspace_id_updated_at_idx" ON "saved_sessions"("user_id", "workspace_id", "updated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "saved_sessions_id_user_id_key" ON "saved_sessions"("id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "saved_session_windows_session_id_sort_order_key" ON "saved_session_windows"("session_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "saved_session_groups_id_window_id_key" ON "saved_session_groups"("id", "window_id");

-- CreateIndex
CREATE UNIQUE INDEX "saved_session_groups_window_id_sort_order_key" ON "saved_session_groups"("window_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "saved_session_tabs_window_id_sort_order_key" ON "saved_session_tabs"("window_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "session_versions_session_id_version_key" ON "session_versions"("session_id", "version");

-- CreateIndex
CREATE INDEX "sync_changes_user_id_entity_type_entity_id_idx" ON "sync_changes"("user_id", "entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "sync_changes_user_id_sequence_key" ON "sync_changes"("user_id", "sequence");

-- CreateIndex
CREATE INDEX "audit_events_user_id_created_at_idx" ON "audit_events"("user_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_sessions" ADD CONSTRAINT "saved_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_sessions" ADD CONSTRAINT "saved_sessions_workspace_id_user_id_fkey" FOREIGN KEY ("workspace_id", "user_id") REFERENCES "workspaces"("id", "user_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_sessions" ADD CONSTRAINT "saved_sessions_source_device_id_user_id_fkey" FOREIGN KEY ("source_device_id", "user_id") REFERENCES "devices"("id", "user_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_session_windows" ADD CONSTRAINT "saved_session_windows_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "saved_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_session_groups" ADD CONSTRAINT "saved_session_groups_window_id_fkey" FOREIGN KEY ("window_id") REFERENCES "saved_session_windows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_session_tabs" ADD CONSTRAINT "saved_session_tabs_window_id_fkey" FOREIGN KEY ("window_id") REFERENCES "saved_session_windows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_session_tabs" ADD CONSTRAINT "saved_session_tabs_group_id_window_id_fkey" FOREIGN KEY ("group_id", "window_id") REFERENCES "saved_session_groups"("id", "window_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_versions" ADD CONSTRAINT "session_versions_session_id_user_id_fkey" FOREIGN KEY ("session_id", "user_id") REFERENCES "saved_sessions"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_versions" ADD CONSTRAINT "session_versions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_versions" ADD CONSTRAINT "session_versions_author_device_id_user_id_fkey" FOREIGN KEY ("author_device_id", "user_id") REFERENCES "devices"("id", "user_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sync_clocks" ADD CONSTRAINT "user_sync_clocks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_changes" ADD CONSTRAINT "sync_changes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_operation_receipts" ADD CONSTRAINT "sync_operation_receipts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_operation_receipts" ADD CONSTRAINT "sync_operation_receipts_device_id_user_id_fkey" FOREIGN KEY ("device_id", "user_id") REFERENCES "devices"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
