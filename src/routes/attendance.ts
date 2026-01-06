import { getAttendance, exportAttendance } from "../controllers/attendanceController";
import { authenticateToken, authorizeRoleOrStaffType, authorizeRoles, } from "../middlewares/auth";
import express from 'express'


const router = express.Router()

router.get('/logs', authenticateToken, getAttendance)

// Export attendance
router.post('/export', authenticateToken, exportAttendance)


export default router