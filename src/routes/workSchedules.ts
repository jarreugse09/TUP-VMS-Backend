import express from "express";
import {
  assignWorkSchedule,
  createWorkSchedule,
  getAssignableUsers,
  getWorkSchedules,
  updateWorkSchedule,
} from "../controllers/scheduleController";
import { authenticateToken, authorizeRoles, validateRbac } from "../middlewares/auth";

const router = express.Router();

router.get(
  "/",
  authenticateToken,
  authorizeRoles("hr_head", "hr_staff", "security_head", "dean", "department_head"),
  getWorkSchedules,
);
router.get(
  "/assignable-users",
  authenticateToken,
  authorizeRoles("hr_head", "hr_staff", "security_head"),
  getAssignableUsers,
);
router.post(
  "/",
  authenticateToken,
  validateRbac(["hr_head", "hr_staff", "security_head"]), // Bug 6 fix — validateRbac has superadmin bypass
  createWorkSchedule,
);
router.put(
  "/:id",
  authenticateToken,
  validateRbac(["hr_head", "hr_staff", "security_head"]), // Bug 6 fix — validateRbac has superadmin bypass
  updateWorkSchedule,
);
router.post(
  "/:id/assign",
  authenticateToken,
  authorizeRoles("hr_head", "hr_staff", "security_head"),
  assignWorkSchedule,
);

export default router;
