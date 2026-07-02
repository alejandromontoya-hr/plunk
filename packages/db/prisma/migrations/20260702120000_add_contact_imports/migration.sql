-- CreateEnum
CREATE TYPE "ImportFileType" AS ENUM ('CSV', 'XLSX');

-- CreateEnum
CREATE TYPE "ImportMode" AS ENUM ('CREATE', 'UPDATE', 'UPSERT');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PREVIEW', 'PROCESSING', 'COMPLETED', 'FAILED', 'UNDOING', 'UNDONE');

-- CreateEnum
CREATE TYPE "ImportChangeAction" AS ENUM ('CREATED', 'UPDATED');

-- CreateTable
CREATE TABLE "contact_imports" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "fileType" "ImportFileType" NOT NULL,
    "rawData" TEXT,
    "mode" "ImportMode" NOT NULL DEFAULT 'UPSERT',
    "mapping" JSONB,
    "status" "ImportStatus" NOT NULL DEFAULT 'PREVIEW',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,
    "undoable" BOOLEAN NOT NULL DEFAULT true,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "undoneAt" TIMESTAMP(3),

    CONSTRAINT "contact_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_import_changes" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "action" "ImportChangeAction" NOT NULL,
    "previousData" JSONB,
    "previousSubscribed" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_import_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contact_imports_projectId_createdAt_idx" ON "contact_imports"("projectId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "contact_imports_status_idx" ON "contact_imports"("status");

-- CreateIndex
CREATE INDEX "contact_import_changes_importId_idx" ON "contact_import_changes"("importId");

-- AddForeignKey
ALTER TABLE "contact_imports" ADD CONSTRAINT "contact_imports_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_import_changes" ADD CONSTRAINT "contact_import_changes_importId_fkey" FOREIGN KEY ("importId") REFERENCES "contact_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

