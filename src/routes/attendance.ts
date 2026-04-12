import { getAttendance, exportAttendance, getMyDTR, updateAttendance, softDeleteAttendance } from "../controllers/attendanceController";
import { triggerAttendanceComputation } from "../controllers/scheduleController";
import { authenticateToken, authorizeRoleOrStaffType, authorizeRoles, validateRbac, requireScopeAccess } from "../middlewares/auth";
import express from 'express'


const router = express.Router()

// GET /api/attendance/logs - Role-scoped attendance logs
router.get(
  '/logs',
  authenticateToken,
  validateRbac(
    ["TUP", "Staff", "Student", "Visitor"],
    ["dean", "department_head", "hr_head", "hr_staff", "security_head", "security_staff"]
  ),
  requireScopeAccess("college"),
  getAttendance,
)

// GET /api/attendance/my-dtr - Own attendance logs
router.get(
  '/my-dtr',
  authenticateToken,
  authorizeRoles("TUP", "Staff"),
  getMyDTR
)

// GET /api/attendance/all - All attendance (HR, Security only)
router.get(
  '/all',
  authenticateToken,
  validateRbac(["Staff"], ["hr_head", "hr_staff", "security_head", "security_staff"]),
  getAttendance,
)

// GET /api/attendance/dept/:id - Department scoped (department_head only)
router.get(
  '/dept/:id',
  authenticateToken,
  validateRbac(["TUP"], ["department_head"]),
  requireScopeAccess("department"),
  getAttendance,
)

// GET /api/attendance/college/:id - College scoped (dean only)
router.get(
  '/college/:id',
  authenticateToken,
  validateRbac(["TUP"], ["dean"]),
  requireScopeAccess("college"),
  getAttendance,
)

// Export attendance
router.post(
  '/export',
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
  ),
  exportAttendance,
)

router.post(
  '/compute',
  authenticateToken,
  authorizeRoles("hr_head"),
  triggerAttendanceComputation,
)

router.put(
  '/:id',
  authenticateToken,
  validateRbac(["TUP"], ["superadmin", "hr_head", "hr_staff"]),
  updateAttendance
)

router.delete(
  '/:id',
  authenticateToken,
  validateRbac(["TUP"], ["superadmin", "hr_head"]),
  softDeleteAttendance
)

export default router
