import express from "express";
import {
  scanQR,
  recordActivity,
  getLogs,
  getActivities,
  visitorScanQR,
  scanTransactionQR,
  getStaffLogs,
  getUserTransactions,
  getUserAttendance,
  exportLogs,
  getMyLogs,
  getMyAttendance,
  getMyTransactions,
} from "../controllers/logController";
import {
  authenticateToken,
  authorizeRoleOrStaffType,
  authorizeRoles,
} from "../middlewares/auth";

const router = express.Router();

// ── Scan endpoints ───────────────────────────────────────────────────────────
router.post("/scan", authenticateToken, authorizeRoleOrStaffType(["TUP", "Staff"], ["TUP", "HR HEAD", "Security"]), scanQR);
router.post("/staff/scan", authenticateToken, authorizeRoles("Staff"), scanTransactionQR);
router.post("/user/scan", authenticateToken, authorizeRoles("Visitor", "Student", "Staff"), visitorScanQR);
router.post("/activity", authenticateToken, recordActivity);

// ── Scoped org-aware log access ───────────────────────────────────────────────
router.get(
  "/logs",
  authenticateToken,
  authorizeRoles(
    "TUP",
    "dean",
    "department_head",
    "hr_head",
    "hr_staff",
    "security_head",
    "security_staff",
  ),
  getLogs,
);

// ── /me routes — MUST come before /logs/staff/ to avoid Express conflicts ────
// Attendance only (check-in/check-out) — no transactions
router.get("/me/attendance", authenticateToken, authorizeRoles("Student", "Visitor", "Staff", "Security"), getMyAttendance);
// Transactions both directions (I scanned someone + someone scanned me)
router.get("/me/transactions", authenticateToken, authorizeRoles("Student", "Visitor", "Staff"), getMyTransactions);
// Legacy — keep for anything still referencing /me
router.get("/me", authenticateToken, authorizeRoles("Student", "Visitor", "Staff"), getMyLogs);

// ── Staff / role-specific ────────────────────────────────────────────────────
router.get("/logs/staff/", authenticateToken, getStaffLogs);
router.get("/logs/transactions", authenticateToken, getUserTransactions);
router.get("/logs/attendance", authenticateToken, getUserAttendance);
router.get("/activities", authenticateToken, getActivities);

// ── Export ───────────────────────────────────────────────────────────────────
router.post(
  "/export",
  authenticateToken,
  authorizeRoles(
    "TUP",
    "dean",
    "department_head",
    "hr_head",
    "hr_staff",
    "security_head",
    "security_staff",
    "Staff",
    "Student",
    "Visitor",
  ),
  exportLogs,
);

export default router;
