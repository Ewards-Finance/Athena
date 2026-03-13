-- Convert LeaveType enum columns to TEXT (preserving existing data)
ALTER TABLE "LeaveRequest" ALTER COLUMN "leaveType" TYPE TEXT USING "leaveType"::TEXT;
ALTER TABLE "LeaveBalance" ALTER COLUMN "leaveType" TYPE TEXT USING "leaveType"::TEXT;
ALTER TABLE "LeavePolicy" ALTER COLUMN "leaveType" TYPE TEXT USING "leaveType"::TEXT;

-- Drop the now-unused enum type
DROP TYPE IF EXISTS "LeaveType";
