-- Half-day leave support: add duration/session fields to LeaveRequest,
-- and convert Int → Float on totalDays, LeaveBalance.total, LeaveBalance.used

-- Add half-day columns to LeaveRequest
ALTER TABLE "LeaveRequest" ADD COLUMN "durationType"  TEXT;
ALTER TABLE "LeaveRequest" ADD COLUMN "singleDayType" TEXT;
ALTER TABLE "LeaveRequest" ADD COLUMN "startDayType"  TEXT;
ALTER TABLE "LeaveRequest" ADD COLUMN "endDayType"    TEXT;

-- totalDays: Int → Float (to support 0.5)
ALTER TABLE "LeaveRequest" ALTER COLUMN "totalDays" TYPE DOUBLE PRECISION;

-- LeaveBalance: total and used Int → Float
ALTER TABLE "LeaveBalance" ALTER COLUMN "total" TYPE DOUBLE PRECISION;
ALTER TABLE "LeaveBalance" ALTER COLUMN "used"  TYPE DOUBLE PRECISION;
