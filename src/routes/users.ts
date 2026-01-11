import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import {
  getProfile,
  requestQRChange,
  getQRRequests,
  approveQRRequest,
  rejectQRRequest,
  getAllUsers,
} from "../controllers/userController";
import { authenticateToken, authorizeRoles } from "../middlewares/auth";

const router = express.Router();

// ensure uploads directory exists
const uploadDir = path.join(process.cwd(), "uploads", "qr-requests");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage });


router.get("/admin/", authenticateToken, getAllUsers)
router.get("/profile", authenticateToken, getProfile);
router.post("/request-qr-change", authenticateToken, upload.single("newQRImage"), requestQRChange);
router.get(
  "/qr-requests",
  authenticateToken,
  authorizeRoles("TUP"),
  getQRRequests
);
router.put(
  "/qr-requests/:requestId/approve",
  authenticateToken,
  authorizeRoles("TUP"),
  approveQRRequest
);
router.put(
  "/qr-requests/:requestId/reject",
  authenticateToken,
  authorizeRoles("TUP"),
  rejectQRRequest
);

export default router;
