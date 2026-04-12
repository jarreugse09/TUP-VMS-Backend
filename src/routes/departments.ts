import { 
  getDepartments, 
  getDepartment, 
  createDepartment, 
  updateDepartment, 
  deleteDepartment 
} from "../controllers/departmentController";
import { authenticateToken, validateRbac, authorizeRoles } from "../middlewares/auth";
import express from "express";

const router = express.Router();

// GET /api/departments - List all (or filtered by college)
// Accessible to: dean, department_head (scoped), hr_head, hr_staff
router.get(
  "/", 
  authenticateToken,
  authorizeRoles("TUP", "dean", "department_head", "hr_head", "hr_staff", "Staff"),
  getDepartments
);

// GET /api/departments/:id - Get single department
router.get("/:id", authenticateToken, getDepartment);

// POST /api/departments - Create (hr_head only)
router.post(
  "/",
  authenticateToken,
  validateRbac(["Staff"], ["hr_head"]),
  createDepartment
);

// PUT /api/departments/:id - Update (hr_head only)
router.put(
  "/:id",
  authenticateToken,
  validateRbac(["Staff"], ["hr_head"]),
  updateDepartment
);

// DELETE /api/departments/:id - Delete (hr_head only)
router.delete(
  "/:id",
  authenticateToken,
  validateRbac(["Staff"], ["hr_head"]),
  deleteDepartment
);

export default router;
