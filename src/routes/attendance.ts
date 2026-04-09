import { getAttendance, exportAttendance } from "../controllers/attendanceController";
import { triggerAttendanceComputation } from "../controllers/scheduleController";
import { authenticateToken, authorizeRoleOrStaffType, authorizeRoles, } from "../middlewares/auth";
import express from 'express'


const router = express.Router()

router.get(
  '/logs',
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


export default router
