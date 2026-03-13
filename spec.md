Project Athena V2 (The Enterprise Blueprint)

1. System Overview
Athena V2 is a centralized Human Resource Management System (HRMS) for Ewards. It is designed to manage employee identities, statutory compliance, leave lifecycles, and financial reimbursements with an emphasis on clean UI and data integrity.

2. Tech Stack (The "Reliable" Stack)
Frontend: React (Vite) + Tailwind CSS + Shadcn UI.

Backend: Node.js + Express + TypeScript.

Database: PostgreSQL (Prisma ORM).

Authentication: JWT with Role-Based Access Control (RBAC):

ADMIN: Full access (Settings, Employee Master, Approvals).

MANAGER: Team view and approval rights.

EMPLOYEE: Self-service (Profile, Leaves, Claims).

3. Core Functional Modules
A. Employee Master (The "Source of Truth")
Personal Profile: Name, Date of Birth, Gender, Blood Group, Personal Email, Emergency Contact.

Employment Details: Employee ID (Unique), Designation, Department, Date of Joining, Office Location (Kolkata), Reporting Manager.

Indian Statutory Compliance: * PAN (Permanent Account Number).

Aadhar Number.

UAN (Universal Account Number for PF).

Bank Details: Account Number, IFSC Code, Bank Name.

Document Management: Ability to upload/download PDF/Images for KYC and Appointment Letters.

B. Leave Management System (Workflow-Driven)
Leave Types: Sick Leave (SL), Casual Leave (CL), Earned Leave (EL), Maternity/Paternity.

Leave Balance: Real-time tracking of used vs. available leaves per employee.

Approval Flow: Employee applies -> Manager gets notified -> Approve/Reject with comments.

Holiday Calendar: Admin-managed list of public/company holidays (e.g., Durga Puja, Eid, Diwali).

C. Reimbursement & Claims (Finance-Focused)
Claim Submission: Employees can file claims under categories: Travel, Food, Internet, or Miscellaneous.

Evidence Upload: Mandatory attachment of bill/receipt images.

Status Tracking: Pending -> Approved -> Paid (linked to Finance Admin action).

D. Organization & Roles
Department Hierarchy: Define departments (Sales, Finance, Tech, HR).

Announcements: A "Notice Board" on the dashboard for company-wide updates.

4. Database Schema (Prisma)
User: Auth details and Role.

Profile: All personal and statutory fields.

LeaveRequest: Status, dates, and relations to User.

Reimbursement: Amount, category, and bill attachments.

Holiday: Name and Date.

5. Frontend Requirements (The "Crisp" Look)
Sidebar Navigation: Dashboard, My Profile, Leaves, Claims, Organization (Admin only).

Stat Cards: "Today's Leaves," "Pending Approvals," "Total Employees."

Forms: Clean, validated forms using React Hook Form and Zod (to prevent garbage data).