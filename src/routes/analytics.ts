import express from "express";
import {
  getAnalyticsOverview,
  getHourlyAnalytics,
} from "../controllers/analyticsController";
import { authenticateToken, authorizeRoles } from "../middlewares/auth";

const router = express.Router();

router.get(
  "/admin",
  authenticateToken,
  authorizeRoles(
    "TUP",
    "dean",
    "department_head",
    "hr_head",
    "hr_staff",
    "security_head",
    "security_staff",
    "top_management",
    "student",
    "visitor",
  ),
  getAnalyticsOverview,
);
router.get(
  "/hourly",
  authenticateToken,
  authorizeRoles(
    "TUP",
    "dean",
    "department_head",
    "hr_head",
    "hr_staff",
    "security_head",
    "security_staff",
    "top_management",
  ),
  getHourlyAnalytics,
);

export default router;
