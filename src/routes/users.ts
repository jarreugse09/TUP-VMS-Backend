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
  adminRegisterUser,
  completeFirstPhotoCapture,
  requestProfilePhotoChange,
} from "../controllers/userController";
import { authenticateToken, authorizeRoles } from "../middlewares/auth";
import { body } from "express-validator";

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

const profileUploadDir = path.join(process.cwd(), "uploads", "profile-requests");
if (!fs.existsSync(profileUploadDir)) {
  fs.mkdirSync(profileUploadDir, { recursive: true });
}

const profileStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, profileUploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const profileUpload = multer({ storage: profileStorage });

router.get("/admin/", authenticateToken, authorizeRoles("TUP"), getAllUsers);
router.post(
  "/admin/register",
  authenticateToken,
  authorizeRoles("TUP"),
  [
    body("firstName").notEmpty(),
    body("surname").notEmpty(),
    body("birthdate").isISO8601(),
    body("role").isIn(["Staff", "Student"]),
    body("staffType")
      .if(body("role").equals("Staff"))
      .notEmpty()
      .withMessage("Staff type is required for Staff role"),
    body("email").isEmail(),
    body("password").isLength({ min: 6 }),
    body("customQR")
      .matches(/^(TUPM|TUPS|TUPV)-\d{2}-\d{4}$/)
      .withMessage("Invalid QR format. Use TUPM/TUPS/TUPV-YY-XXXX."),
  ],
  adminRegisterUser,
);
router.get("/profile", authenticateToken, getProfile);
router.post(
  "/profile/first-photo",
  authenticateToken,
  completeFirstPhotoCapture,
);
router.post(
  "/request-qr-change",
  authenticateToken,
  upload.single("newQRImage"),
  requestQRChange,
);
router.post(
  "/request-profile-photo",
  authenticateToken,
  profileUpload.single("newPhotoImage"),
  requestProfilePhotoChange,
);
router.get(
  "/qr-requests",
  authenticateToken,
  authorizeRoles("TUP"),
  getQRRequests,
);
router.put(
  "/qr-requests/:requestId/approve",
  authenticateToken,
  authorizeRoles("TUP"),
  approveQRRequest,
);
router.put(
  "/qr-requests/:requestId/reject",
  authenticateToken,
  authorizeRoles("TUP"),
  rejectQRRequest,
);

export default router;
