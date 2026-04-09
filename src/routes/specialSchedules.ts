import express from "express";
import {
  createSpecialSchedule,
  deleteSpecialSchedule,
  getSpecialSchedules,
  updateSpecialSchedule,
} from "../controllers/scheduleController";
import { authenticateToken, authorizeRoles } from "../middlewares/auth";

const router = express.Router();

router.get(
  "/",
  authenticateToken,
  authorizeRoles("hr_head", "hr_staff"),
  getSpecialSchedules,
);
router.post(
  "/",
  authenticateToken,
  authorizeRoles("hr_head", "hr_staff"),
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
