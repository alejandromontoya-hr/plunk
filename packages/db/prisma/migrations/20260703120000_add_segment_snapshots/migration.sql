-- AlterTable: internal snapshot flag + snapshot origin
ALTER TABLE "segments" ADD COLUMN "internal" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "segments" ADD COLUMN "sourceSegmentId" TEXT;

-- CreateIndex
CREATE INDEX "segments_projectId_internal_idx" ON "segments"("projectId", "internal");

-- AddForeignKey
ALTER TABLE "segments" ADD CONSTRAINT "segments_sourceSegmentId_fkey" FOREIGN KEY ("sourceSegmentId") REFERENCES "segments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
