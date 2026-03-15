-- AlterTable
ALTER TABLE "AuditLog"
ADD COLUMN "subjectEntity" TEXT,
ADD COLUMN "subjectId" TEXT,
ADD COLUMN "subjectLabel" TEXT,
ADD COLUMN "subjectMeta" JSONB;
