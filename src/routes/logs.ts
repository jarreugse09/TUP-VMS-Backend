import express from "express";
import {
  scanQR,
  recordActivity,
  getLogs,
  getActivities, visitorScanQR,
  scanTransactionQR,
  getStaffLogs,
  exportLogs,
} from "../controllers/logController";
import { authenticateToken, authorizeRoleOrStaffType, authorizeRoles, } from "../middlewares/auth";

const router = express.Router();

router.post(
  "/scan",
  authenticateToken,
  authorizeRoleOrStaffType(
    ["TUP", "Staff"],
    ["TUP", "HR HEAD", "Security"]
  ),
  scanQR
);


router.post("/staff/scan", authenticateToken, authorizeRoles("Staff"), scanTransactionQR);

router.post("/user/scan", authenticateToken, authorizeRoles("Visitor", "Student"), visitorScanQR);
router.post("/activity", authenticateToken, recordActivity);
router.get("/logs", authenticateToken, authorizeRoles("TUP"), getLogs);

router.get("/logs/staff/", authenticateToken, authorizeRoles("TUP", "Staff"), getStaffLogs);

router.get("/activities", authenticateToken, getActivities);

// Export endpoint
router.post("/export", authenticateToken, exportLogs);

export default router;
