import express from "express";
import multer from "multer";
import {
  downloadBackup,
  restoreBackup,
  getBackupLogs,
} from "../controllers/backupController";
import { authenticateToken, validateRbac } from "../middlewares/auth";

const router = express.Router();

// Memory storage to process compression easily
const upload = multer({
  storage: multer.memoryStorage(),
});

// GET route for backup logs
router.get(
  "/logs",
  authenticateToken,
  validateRbac([], ["superadmin"]),
  getBackupLogs
);

// POST route for backup download (manual dump)
router.post(
  "/download",
  authenticateToken,
  validateRbac([], ["superadmin"]),
  downloadBackup
);

// POST route for backup restore
router.post(
  "/restore",
  authenticateToken,
  validateRbac([], ["superadmin"]),
  upload.single("file"),
  restoreBackup
);

export default router;
