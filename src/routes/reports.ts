import express from "express";
import { 
  generateDTR,
  generateBulkDTR,
  generateDepartmentReport,
  generateCollegeReport,
  generateAnomalyReport,
  generateVisitAnomalyReport,
  generateSecurityPerformanceReport,
  generateExecutiveReport
} from "../controllers/reportController";
import { authenticateToken, validateRbac } from "../middlewares/auth";

const router = express.Router();

router.get("/dtr", authenticateToken, generateDTR);
router.get("/bulk-dtr", authenticateToken, generateBulkDTR);
router.post("/dtr-bulk", authenticateToken, validateRbac([], ["dean", "superadmin", "hr_head"]), generateBulkDTR);
router.get("/department", authenticateToken, validateRbac([], ["dean", "department_head", "hr_head", "superadmin"]), generateDepartmentReport);
router.get("/college", authenticateToken, validateRbac([], ["dean", "hr_head", "superadmin"]), generateCollegeReport);
router.get("/anomaly", authenticateToken, validateRbac([], ["hr_head", "superadmin", "security_head"]), generateAnomalyReport);
router.get("/visit-anomaly", authenticateToken, validateRbac([], ["hr_head", "superadmin", "security_head"]), generateVisitAnomalyReport);
router.get("/security-performance", authenticateToken, validateRbac([], ["security_head", "superadmin"]), generateSecurityPerformanceReport);
router.get("/executive", authenticateToken, validateRbac([], ["top_management", "hr_head", "superadmin"]), generateExecutiveReport);

export default router;
