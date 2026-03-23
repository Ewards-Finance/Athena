-- CreateEnum
CREATE TYPE "PolicyScope" AS ENUM ('GLOBAL', 'COMPANY_SPECIFIC');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'MANAGER', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ClaimCategory" AS ENUM ('TRAVEL', 'FOOD', 'INTERNET', 'MISCELLANEOUS');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('PENDING', 'APPROVED', 'PAID', 'REJECTED');

-- CreateEnum
CREATE TYPE "ComponentType" AS ENUM ('EARNING', 'DEDUCTION');

-- CreateEnum
CREATE TYPE "CalcType" AS ENUM ('PERCENTAGE_OF_CTC', 'FIXED', 'MANUAL', 'AUTO_PT', 'AUTO_TDS');

-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'FINALIZED');

-- CreateEnum
CREATE TYPE "PayrollRunType" AS ENUM ('REGULAR', 'FULL_AND_FINAL');

-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('PENDING_JOIN', 'PROBATION', 'INTERNSHIP', 'REGULAR_FULL_TIME', 'NOTICE_PERIOD', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ACTIVE', 'TRANSFERRED', 'CLOSED');

-- CreateEnum
CREATE TYPE "RevisionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DocCategory" AS ENUM ('OFFER_LETTER', 'APPOINTMENT_LETTER', 'EXPERIENCE_LETTER', 'KYC', 'CONTRACT', 'PAYSLIP', 'OTHER');

-- CreateEnum
CREATE TYPE "ExitStatus" AS ENUM ('INITIATED', 'NOTICE_PERIOD', 'CLEARANCE_PENDING', 'SETTLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ClearanceStatus" AS ENUM ('PENDING', 'CLEARED');

-- CreateEnum
CREATE TYPE "AssetCategory" AS ENUM ('LAPTOP', 'PHONE', 'CHARGER', 'MONITOR', 'KEYBOARD', 'MOUSE', 'SIM_CARD', 'ACCESS_CARD', 'ID_CARD', 'SOFTWARE_LICENSE', 'OTHER');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('AVAILABLE', 'ASSIGNED', 'UNDER_REPAIR', 'RETIRED');

-- CreateEnum
CREATE TYPE "ImportType" AS ENUM ('ATTENDANCE', 'EMPLOYEE_BULK', 'ASSET_BULK');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PREVIEWED', 'IMPORTED', 'PARTIALLY_IMPORTED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "LoanStatus" AS ENUM ('PENDING', 'APPROVED', 'ACTIVE', 'CLOSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CompOffStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'USED');

-- CreateEnum
CREATE TYPE "ServiceRequestCategory" AS ENUM ('SALARY_ISSUE', 'ATTENDANCE_CORRECTION', 'DOCUMENT_REQUEST', 'REIMBURSEMENT_ISSUE', 'LEAVE_CORRECTION', 'LETTER_REQUEST', 'IT_SUPPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "ServiceRequestStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'EMPLOYEE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "employmentStatus" "EmploymentStatus" NOT NULL DEFAULT 'REGULAR_FULL_TIME',
    "adminScope" TEXT,
    "visibilityScope" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Profile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "middleName" TEXT,
    "lastName" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3),
    "gender" TEXT,
    "bloodGroup" TEXT,
    "personalEmail" TEXT,
    "phone" TEXT,
    "secondaryPhone" TEXT,
    "emergencyContact" TEXT,
    "employeeId" TEXT NOT NULL,
    "designation" TEXT NOT NULL DEFAULT '',
    "department" TEXT NOT NULL DEFAULT '',
    "dateOfJoining" TIMESTAMP(3),
    "officeLocation" TEXT DEFAULT 'Kolkata',
    "managerId" TEXT,
    "pan" TEXT,
    "aadharNumber" TEXT,
    "uan" TEXT,
    "bankAccountNumber" TEXT NOT NULL DEFAULT '',
    "ifscCode" TEXT NOT NULL DEFAULT '',
    "bankName" TEXT NOT NULL DEFAULT '',
    "kycDocumentUrl" TEXT,
    "appointmentLetterUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "annualCtc" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "employmentType" TEXT NOT NULL DEFAULT 'FULL_TIME',

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "managerId" TEXT,
    "leaveType" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "totalDays" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "LeaveStatus" NOT NULL DEFAULT 'PENDING',
    "managerComment" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "durationType" TEXT,
    "singleDayType" TEXT,
    "startDayType" TEXT,
    "endDayType" TEXT,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reimbursement" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "category" "ClaimCategory" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "description" TEXT NOT NULL,
    "billUrl" TEXT,
    "status" "ClaimStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "paidNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reimbursement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveBalance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "leaveType" TEXT NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "used" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "type" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeavePolicy" (
    "id" TEXT NOT NULL,
    "leaveType" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "defaultTotal" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isUnlimited" BOOLEAN NOT NULL DEFAULT false,
    "documentRequired" BOOLEAN NOT NULL DEFAULT false,
    "documentAfterDays" INTEGER,
    "carryForwardEnabled" BOOLEAN NOT NULL DEFAULT false,
    "carryForwardMaxDays" INTEGER,
    "encashable" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeavePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "link" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollComponent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ComponentType" NOT NULL,
    "calcType" "CalcType" NOT NULL,
    "value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRun" (
    "id" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "status" "PayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "processedBy" TEXT NOT NULL,
    "companyId" TEXT,
    "policyVersionId" TEXT,
    "runType" "PayrollRunType" NOT NULL DEFAULT 'REGULAR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayslipEntry" (
    "id" TEXT NOT NULL,
    "payrollRunId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "monthlyCtc" DOUBLE PRECISION NOT NULL,
    "workingDays" INTEGER NOT NULL,
    "lwpDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paidDays" DOUBLE PRECISION NOT NULL,
    "earnings" JSONB NOT NULL,
    "deductions" JSONB NOT NULL,
    "reimbursements" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grossPay" DOUBLE PRECISION NOT NULL,
    "totalDeductions" DOUBLE PRECISION NOT NULL,
    "netPay" DOUBLE PRECISION NOT NULL,
    "companyLegalName" TEXT,
    "companyAddress" TEXT,
    "companyPan" TEXT,
    "employeeCode" TEXT,
    "designationSnapshot" TEXT,
    "arrearsAmount" DOUBLE PRECISION DEFAULT 0,
    "arrearsNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayslipEntry_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "payrollPrefix" TEXT,
    "pan" TEXT,
    "tan" TEXT,
    "gstin" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "logoUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeCompanyAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeCode" TEXT,
    "designation" TEXT,
    "department" TEXT,
    "reportingManagerId" TEXT,
    "annualCTC" DOUBLE PRECISION,
    "employmentType" TEXT,
    "joiningDate" TIMESTAMP(3),
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeCompanyAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyVersion" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "versionCode" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "scope" "PolicyScope" NOT NULL DEFAULT 'GLOBAL',
    "companyId" TEXT,
    "notes" TEXT,
    "publishedBy" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyRule" (
    "id" TEXT NOT NULL,
    "policyVersionId" TEXT NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "ruleValue" TEXT NOT NULL,
    "valueType" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyAcknowledgement" (
    "id" TEXT NOT NULL,
    "policyVersionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMP(3),
    "isAcknowledged" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyAcknowledgement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "subjectEntity" TEXT,
    "subjectId" TEXT,
    "subjectLabel" TEXT,
    "subjectMeta" JSONB,
    "oldValues" JSONB,
    "newValues" JSONB,
    "reason" TEXT,
    "changeSource" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryRevision" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "oldCtc" DOUBLE PRECISION NOT NULL,
    "newCtc" DOUBLE PRECISION NOT NULL,
    "reason" TEXT,
    "revisedBy" TEXT NOT NULL,
    "status" "RevisionStatus" NOT NULL DEFAULT 'PENDING',
    "proposedBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalaryRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeDocument" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" "DocCategory" NOT NULL DEFAULT 'OTHER',
    "name" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "description" TEXT,
    "uploadedBy" TEXT NOT NULL,
    "expiryDate" TIMESTAMP(3),
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "reminderSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AbsenceRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "markedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AbsenceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "scopes" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupLog" (
    "id" TEXT NOT NULL,
    "triggeredBy" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "fileName" TEXT,
    "commitSha" TEXT,
    "fileSizeKb" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackupLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceAdjustment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "adjustmentDays" DOUBLE PRECISION NOT NULL,
    "reason" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExitRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "initiatedBy" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "lastWorkingDate" TIMESTAMP(3) NOT NULL,
    "noticePeriodDays" INTEGER NOT NULL,
    "buyoutDays" INTEGER,
    "buyoutAmount" DOUBLE PRECISION,
    "status" "ExitStatus" NOT NULL DEFAULT 'INITIATED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExitRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExitClearance" (
    "id" TEXT NOT NULL,
    "exitRequestId" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "clearedBy" TEXT,
    "status" "ClearanceStatus" NOT NULL DEFAULT 'PENDING',
    "remarks" TEXT,
    "clearedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExitClearance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinalSettlement" (
    "id" TEXT NOT NULL,
    "exitRequestId" TEXT NOT NULL,
    "lastMonthSalaryProrated" DOUBLE PRECISION NOT NULL,
    "leaveEncashmentDays" DOUBLE PRECISION NOT NULL,
    "leaveEncashmentAmount" DOUBLE PRECISION NOT NULL,
    "pendingClaimsAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "arrearsPending" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bonusPending" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "noticePeriodRecovery" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "loanOutstanding" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "otherDeductions" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalPayable" DOUBLE PRECISION NOT NULL,
    "processedBy" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinalSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "assetTag" TEXT NOT NULL,
    "category" "AssetCategory" NOT NULL,
    "serialNumber" TEXT,
    "purchaseDate" TIMESTAMP(3),
    "purchaseCost" DOUBLE PRECISION,
    "status" "AssetStatus" NOT NULL DEFAULT 'AVAILABLE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetAssignment" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "returnedAt" TIMESTAMP(3),
    "conditionOut" TEXT,
    "conditionIn" TEXT,
    "notes" TEXT,
    "assignedBy" TEXT NOT NULL,

    CONSTRAINT "AssetAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "type" "ImportType" NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "totalRows" INTEGER NOT NULL,
    "successRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "status" "ImportStatus" NOT NULL DEFAULT 'PREVIEWED',
    "errorLog" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "installments" INTEGER NOT NULL,
    "monthlyEMI" DOUBLE PRECISION NOT NULL,
    "interestRate" DOUBLE PRECISION NOT NULL DEFAULT 9.0,
    "reason" TEXT NOT NULL,
    "status" "LoanStatus" NOT NULL DEFAULT 'PENDING',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "startMonth" INTEGER,
    "startYear" INTEGER,
    "paidInstallments" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoanRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompOff" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "earnedDate" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "CompOffStatus" NOT NULL DEFAULT 'PENDING',
    "approvedBy" TEXT,
    "usedOn" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompOff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TravelProof" (
    "id" TEXT NOT NULL,
    "leaveRequestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "proofDate" TIMESTAMP(3) NOT NULL,
    "geoLat" DOUBLE PRECISION,
    "geoLng" DOUBLE PRECISION,
    "mapsLink" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TravelProof_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" "ServiceRequestCategory" NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "ServiceRequestStatus" NOT NULL DEFAULT 'OPEN',
    "assignedTo" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DelegateApprover" (
    "id" TEXT NOT NULL,
    "delegatorId" TEXT NOT NULL,
    "delegateId" TEXT NOT NULL,
    "fromDate" TIMESTAMP(3) NOT NULL,
    "toDate" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DelegateApprover_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Profile_userId_key" ON "Profile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Profile_employeeId_key" ON "Profile"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveBalance_userId_year_leaveType_key" ON "LeaveBalance"("userId", "year", "leaveType");

-- CreateIndex
CREATE UNIQUE INDEX "LeavePolicy_leaveType_key" ON "LeavePolicy"("leaveType");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollComponent_name_key" ON "PayrollComponent"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_month_year_companyId_runType_key" ON "PayrollRun"("month", "year", "companyId", "runType");

-- CreateIndex
CREATE UNIQUE INDEX "PayslipEntry_payrollRunId_userId_key" ON "PayslipEntry"("payrollRunId", "userId");

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

-- CreateIndex
CREATE UNIQUE INDEX "Company_code_key" ON "Company"("code");

-- CreateIndex
CREATE INDEX "EmployeeCompanyAssignment_userId_status_idx" ON "EmployeeCompanyAssignment"("userId", "status");

-- CreateIndex
CREATE INDEX "EmployeeCompanyAssignment_companyId_idx" ON "EmployeeCompanyAssignment"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyVersion_versionCode_key" ON "PolicyVersion"("versionCode");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyRule_policyVersionId_ruleKey_key" ON "PolicyRule"("policyVersionId", "ruleKey");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyAcknowledgement_policyVersionId_userId_key" ON "PolicyAcknowledgement"("policyVersionId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "SystemSetting_key_key" ON "SystemSetting"("key");

-- CreateIndex
CREATE UNIQUE INDEX "AbsenceRecord_userId_date_key" ON "AbsenceRecord"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_prefix_key" ON "ApiKey"("prefix");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceAdjustment_userId_month_year_key" ON "AttendanceAdjustment"("userId", "month", "year");

-- CreateIndex
CREATE UNIQUE INDEX "ExitRequest_userId_key" ON "ExitRequest"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "FinalSettlement_exitRequestId_key" ON "FinalSettlement"("exitRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_assetTag_key" ON "Asset"("assetTag");

-- CreateIndex
CREATE INDEX "AssetAssignment_assetId_idx" ON "AssetAssignment"("assetId");

-- CreateIndex
CREATE INDEX "AssetAssignment_userId_idx" ON "AssetAssignment"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CompOff_userId_earnedDate_key" ON "CompOff"("userId", "earnedDate");

-- CreateIndex
CREATE UNIQUE INDEX "TravelProof_leaveRequestId_proofDate_key" ON "TravelProof"("leaveRequestId", "proofDate");

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reimbursement" ADD CONSTRAINT "Reimbursement_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveBalance" ADD CONSTRAINT "LeaveBalance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "PolicyVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayslipEntry" ADD CONSTRAINT "PayslipEntry_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayslipEntry" ADD CONSTRAINT "PayslipEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkLog" ADD CONSTRAINT "WorkLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PunchMapping" ADD CONSTRAINT "PunchMapping_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_importId_fkey" FOREIGN KEY ("importId") REFERENCES "AttendanceImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeCompanyAssignment" ADD CONSTRAINT "EmployeeCompanyAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeCompanyAssignment" ADD CONSTRAINT "EmployeeCompanyAssignment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeCompanyAssignment" ADD CONSTRAINT "EmployeeCompanyAssignment_reportingManagerId_fkey" FOREIGN KEY ("reportingManagerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyVersion" ADD CONSTRAINT "PolicyVersion_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyRule" ADD CONSTRAINT "PolicyRule_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "PolicyVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyAcknowledgement" ADD CONSTRAINT "PolicyAcknowledgement_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "PolicyVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyAcknowledgement" ADD CONSTRAINT "PolicyAcknowledgement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryRevision" ADD CONSTRAINT "SalaryRevision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryRevision" ADD CONSTRAINT "SalaryRevision_revisedBy_fkey" FOREIGN KEY ("revisedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDocument" ADD CONSTRAINT "EmployeeDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbsenceRecord" ADD CONSTRAINT "AbsenceRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceAdjustment" ADD CONSTRAINT "AttendanceAdjustment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExitRequest" ADD CONSTRAINT "ExitRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExitClearance" ADD CONSTRAINT "ExitClearance_exitRequestId_fkey" FOREIGN KEY ("exitRequestId") REFERENCES "ExitRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinalSettlement" ADD CONSTRAINT "FinalSettlement_exitRequestId_fkey" FOREIGN KEY ("exitRequestId") REFERENCES "ExitRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetAssignment" ADD CONSTRAINT "AssetAssignment_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetAssignment" ADD CONSTRAINT "AssetAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanRequest" ADD CONSTRAINT "LoanRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompOff" ADD CONSTRAINT "CompOff_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravelProof" ADD CONSTRAINT "TravelProof_leaveRequestId_fkey" FOREIGN KEY ("leaveRequestId") REFERENCES "LeaveRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravelProof" ADD CONSTRAINT "TravelProof_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DelegateApprover" ADD CONSTRAINT "DelegateApprover_delegatorId_fkey" FOREIGN KEY ("delegatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DelegateApprover" ADD CONSTRAINT "DelegateApprover_delegateId_fkey" FOREIGN KEY ("delegateId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
