/*
  Warnings:

  - Made the column `designation` on table `Profile` required. This step will fail if there are existing NULL values in that column.
  - Made the column `department` on table `Profile` required. This step will fail if there are existing NULL values in that column.
  - Made the column `bankAccountNumber` on table `Profile` required. This step will fail if there are existing NULL values in that column.
  - Made the column `ifscCode` on table `Profile` required. This step will fail if there are existing NULL values in that column.
  - Made the column `bankName` on table `Profile` required. This step will fail if there are existing NULL values in that column.
  - Made the column `annualCtc` on table `Profile` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "employmentType" TEXT NOT NULL DEFAULT 'FULL_TIME',
ALTER COLUMN "designation" SET NOT NULL,
ALTER COLUMN "designation" SET DEFAULT '',
ALTER COLUMN "department" SET NOT NULL,
ALTER COLUMN "department" SET DEFAULT '',
ALTER COLUMN "bankAccountNumber" SET NOT NULL,
ALTER COLUMN "bankAccountNumber" SET DEFAULT '',
ALTER COLUMN "ifscCode" SET NOT NULL,
ALTER COLUMN "ifscCode" SET DEFAULT '',
ALTER COLUMN "bankName" SET NOT NULL,
ALTER COLUMN "bankName" SET DEFAULT '',
ALTER COLUMN "annualCtc" SET NOT NULL,
ALTER COLUMN "annualCtc" SET DEFAULT 0;

-- CreateTable
CREATE TABLE "WorkLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'APPROVED',
    "rejectedBy" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeclaredWFH" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeclaredWFH_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PunchMapping" (
    "id" TEXT NOT NULL,
    "enNo" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PunchMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceImport" (
    "id" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "importedBy" TEXT NOT NULL,
    "recordCount" INTEGER NOT NULL,
    "unmappedEnNos" JSONB NOT NULL,
    "arrivalTime" TEXT,
    "extensionDates" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "checkIn" TIMESTAMP(3),
    "checkOut" TIMESTAMP(3),
    "hoursWorked" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "checkInManual" TIMESTAMP(3),
    "isLate" BOOLEAN NOT NULL DEFAULT false,
    "lwpDeduction" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkLog_userId_date_key" ON "WorkLog"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DeclaredWFH_date_key" ON "DeclaredWFH"("date");

-- CreateIndex
CREATE UNIQUE INDEX "PunchMapping_enNo_key" ON "PunchMapping"("enNo");

-- CreateIndex
CREATE UNIQUE INDEX "PunchMapping_userId_key" ON "PunchMapping"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceImport_month_year_key" ON "AttendanceImport"("month", "year");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceRecord_userId_date_key" ON "AttendanceRecord"("userId", "date");

-- AddForeignKey
ALTER TABLE "WorkLog" ADD CONSTRAINT "WorkLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PunchMapping" ADD CONSTRAINT "PunchMapping_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_importId_fkey" FOREIGN KEY ("importId") REFERENCES "AttendanceImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
