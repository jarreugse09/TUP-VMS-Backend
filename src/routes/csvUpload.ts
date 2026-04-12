import express from "express";
import multer from "multer";
import {
  uploadAttendanceCSV,
  uploadTransactionCSV,
  uploadVisitLogCSV,
  getAttendanceTemplate,
  getTransactionTemplate,
  getVisitLogTemplate,
  getUploadLogs,
} from "../controllers/csvUploadController";
import { authenticateToken, validateRbac } from "../middlewares/auth";

const router = express.Router();

// Memory storage to process buffer directly
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

// Middleware for auth and RBAC mapping
const requireCsvAuth = [
  authenticateToken,
  validateRbac([], ["superadmin", "hr_head", "hr_staff"]),
];

// POST routes for CSV upload
router.post("/attendance", ...requireCsvAuth, upload.single("file"), uploadAttendanceCSV);
router.post("/transaction", ...requireCsvAuth, upload.single("file"), uploadTransactionCSV);
router.post("/visit-log", ...requireCsvAuth, upload.single("file"), uploadVisitLogCSV);

// GET routes for CSV templates and logs
router.get("/logs", ...requireCsvAuth, getUploadLogs);
router.get("/template/attendance", ...requireCsvAuth, getAttendanceTemplate);
router.get("/template/transaction", ...requireCsvAuth, getTransactionTemplate);
router.get("/template/visit-log", ...requireCsvAuth, getVisitLogTemplate);

export default router;
