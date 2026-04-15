import express from "express";
import {
  createSpecialSchedule,
  deleteSpecialSchedule,
  getSpecialSchedules,
  updateSpecialSchedule,
} from "../controllers/scheduleController";
import { authenticateToken, authorizeRoles, validateRbac } from "../middlewares/auth";

const router = express.Router();

router.get(
  "/",
  authenticateToken,
  validateRbac(["hr_head", "hr_staff"]), // Bug 1 fix — validateRbac has superadmin bypass
  getSpecialSchedules,
);
router.post(
  "/",
  authenticateToken,
  validateRbac(["hr_head", "hr_staff"]), // Bug 1 fix — validateRbac has superadmin bypass
  createSpecialSchedule,
);
router.put(
  "/:id",
  authenticateToken,
  authorizeRoles("hr_head", "hr_staff"),
  updateSpecialSchedule,
);
router.delete(
  "/:id",
  authenticateToken,
  authorizeRoles("hr_head"),
  deleteSpecialSchedule,
);

export default router;
