import express from "express";
import { authenticateToken, validateRbac } from "../middlewares/auth";
import {
  registerStudentVisitor,
  registerFaculty,
  registerDepartmentHead,
  registerDean,
  registerTopManagement,
  registerNonAcademic,
  registerSuperadmin,
  registerHr,
  registerSecurity,
  login,
  refreshAccessToken,
} from "../controllers/authController";
import { loginRateLimiter } from "../middlewares/rateLimiter";

const router = express.Router();

// Public routes
router.post("/register/student-visitor", registerStudentVisitor);
router.post("/register/faculty", registerFaculty);
router.post("/register/superadmin", registerSuperadmin); // guards itself internally
router.post("/login", loginRateLimiter, login);
router.post("/refresh", refreshAccessToken);

// Admin-only scoped routes
router.post(
  "/register/department-head",
  authenticateToken,
  validateRbac([], ["superadmin", "hr_head"]),
  registerDepartmentHead
);

router.post(
  "/register/dean",
  authenticateToken,
  validateRbac([], ["superadmin", "hr_head"]),
  registerDean
);

router.post(
  "/register/top-management",
  authenticateToken,
  validateRbac([], ["superadmin"]),
  registerTopManagement
);

router.post(
  "/register/non-academic",
  authenticateToken,
  validateRbac([], ["superadmin", "hr_head", "hr_staff"]),
  registerNonAcademic
);

router.post(
  "/register/hr",
  authenticateToken,
  validateRbac([], ["superadmin", "hr_head"]),
  registerHr
);

router.post(
  "/register/security",
  authenticateToken,
  validateRbac([], ["superadmin", "hr_head", "security_head"]),
  registerSecurity
);

export default router;
