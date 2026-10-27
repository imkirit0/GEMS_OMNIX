-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "app";

-- CreateEnum
CREATE TYPE "app"."CentreStatus" AS ENUM ('INACTIVE', 'ACTIVE');

-- CreateEnum
CREATE TYPE "app"."UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "app"."ScopeKind" AS ENUM ('ALL', 'REGION', 'AREA', 'CENTRE');

-- CreateEnum
CREATE TYPE "app"."AuditOutcome" AS ENUM ('OK', 'DENIED');

-- CreateEnum
CREATE TYPE "app"."GapRule" AS ENUM ('GAPLESS', 'UNIQUE');

-- CreateTable
CREATE TABLE "app"."region" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "region_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."area" (
    "id" SERIAL NOT NULL,
    "region_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "area_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."centre" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "area_id" INTEGER NOT NULL,
    "centre_class" TEXT,
    "status" "app"."CentreStatus" NOT NULL DEFAULT 'INACTIVE',

    CONSTRAINT "centre_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."app_user" (
    "id" UUID NOT NULL,
    "login" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "status" "app"."UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."role" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."permission" (
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "permission_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "app"."role_permission" (
    "role_id" INTEGER NOT NULL,
    "permission_key" TEXT NOT NULL,

    CONSTRAINT "role_permission_pkey" PRIMARY KEY ("role_id","permission_key")
);

-- CreateTable
CREATE TABLE "app"."role_assignment" (
    "id" SERIAL NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" INTEGER NOT NULL,
    "scope_kind" "app"."ScopeKind" NOT NULL,
    "region_id" INTEGER,
    "area_id" INTEGER,
    "scope_centre_id" INTEGER,

    CONSTRAINT "role_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."app_session" (
    "token_hash" BYTEA NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "step_up_at" TIMESTAMPTZ,

    CONSTRAINT "app_session_pkey" PRIMARY KEY ("token_hash")
);

-- CreateTable
CREATE TABLE "app"."audit_log" (
    "id" BIGSERIAL NOT NULL,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" UUID,
    "action" TEXT NOT NULL,
    "outcome" "app"."AuditOutcome" NOT NULL,
    "target_centre_id" INTEGER,
    "target_type" TEXT,
    "target_id" TEXT,
    "detail" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."number_series" (
    "centre_id" INTEGER NOT NULL,
    "doc_type" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "gap_rule" "app"."GapRule" NOT NULL,
    "current" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "number_series_pkey" PRIMARY KEY ("centre_id","doc_type","period")
);

-- CreateIndex
CREATE UNIQUE INDEX "region_code_key" ON "app"."region"("code");

-- CreateIndex
CREATE UNIQUE INDEX "area_region_id_name_key" ON "app"."area"("region_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "centre_code_key" ON "app"."centre"("code");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_login_key" ON "app"."app_user"("login");

-- CreateIndex
CREATE UNIQUE INDEX "role_key_key" ON "app"."role"("key");

-- CreateIndex
CREATE INDEX "role_assignment_user_id_idx" ON "app"."role_assignment"("user_id");

-- CreateIndex
CREATE INDEX "app_session_user_id_idx" ON "app"."app_session"("user_id");

-- CreateIndex
CREATE INDEX "audit_log_at_idx" ON "app"."audit_log"("at");

-- AddForeignKey
ALTER TABLE "app"."area" ADD CONSTRAINT "area_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "app"."region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."centre" ADD CONSTRAINT "centre_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "app"."area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."role_permission" ADD CONSTRAINT "role_permission_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "app"."role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."role_permission" ADD CONSTRAINT "role_permission_permission_key_fkey" FOREIGN KEY ("permission_key") REFERENCES "app"."permission"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."role_assignment" ADD CONSTRAINT "role_assignment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app"."app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."role_assignment" ADD CONSTRAINT "role_assignment_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "app"."role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."role_assignment" ADD CONSTRAINT "role_assignment_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "app"."region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."role_assignment" ADD CONSTRAINT "role_assignment_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "app"."area"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."role_assignment" ADD CONSTRAINT "role_assignment_scope_centre_id_fkey" FOREIGN KEY ("scope_centre_id") REFERENCES "app"."centre"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."app_session" ADD CONSTRAINT "app_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app"."app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."number_series" ADD CONSTRAINT "number_series_centre_id_fkey" FOREIGN KEY ("centre_id") REFERENCES "app"."centre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
