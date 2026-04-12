import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import {
  getProfile,
  requestQRChange,
  getQRRequests,
  createQRRequest,
  approveQRRequest,
  rejectQRRequest,
  editQRRequest,
  deleteQRRequest,
  getAllUsers,
  getUserById,
  adminRegisterUser,
  completeFirstPhotoCapture,
  requestProfilePhotoChange,
  recordConsent,
  suspendUser,
  blockUser,
  unblockUser,
  directUpdatePhoto,
} from "../controllers/userController";
import { authenticateToken, authorizeRoles, validateRbac } from "../middlewares/auth";
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

const profileUploadDir = path.join(
  process.cwd(),
  "uploads",
  "profile-requests",
);
if (!fs.existsSync(profileUploadDir)) {
  fs.mkdirSync(profileUploadDir, { recursive: true });
}

const profileStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, profileUploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const profileUpload = multer({ storage: profileStorage });

router.get(
  "/admin/",
  authenticateToken,
  authorizeRoles(
    "TUP",
    "dean",
    "department_head",
    "hr_head",
    "hr_staff",
    "security_head",
  ),
  getAllUsers,
);

router.get(
  "/admin/:id",
  authenticateToken,
  authorizeRoles(
    "TUP",
    "dean",
    "department_head",
    "hr_head",
    "hr_staff",
    "security_head",
  ),
  getUserById,
);

router.post(
  "/admin/register",
  authenticateToken,
  authorizeRoles("TUP", "hr_head", "hr_staff", "security_head"),
  [
    body("firstName").notEmpty(),
    body("surname").notEmpty(),
    body("birthdate").isISO8601(),
    body("role").isIn(["TUP", "Staff", "Student", "Visitor"]),
    body("staffType")
      .if(body("role").equals("Staff"))
      .notEmpty()
      .withMessage("Staff type is required for Staff role"),
    body("subRole")
      .optional()
      .isString()
      .withMessage("Sub-role must be a string"),
    body("designation")
      .optional()
      .isString()
      .withMessage("Designation must be a string"),
    body("officeUnit")
      .optional()
      .isString()
      .withMessage("Office/unit must be a string"),
    body("college")
      .optional()
      .isString()
      .withMessage("College must be a string"),
    body("department")
      .optional()
      .isString()
      .withMessage("Department must be a string"),
    body("supervisorEmail")
      .optional()
      .isEmail()
      .withMessage("Supervisor email must be valid"),
    body("email").isEmail(),
    body("password").isLength({ min: 6 }),
    body("customQR")
      .matches(/^(TUPM|TUPS|TUPV)-\d{2}-\d{4}$/)
      .withMessage("Invalid QR format. Use TUPM/TUPS/TUPV-YY-XXXX."),
  ],
  adminRegisterUser,
);
router.get("/profile", authenticateToken, getProfile);
// DPA 2012 — consent endpoint: all authenticated users
router.put("/me/consent", authenticateToken, recordConsent);
// PUT /api/users/me/photo — direct update for Staff/TUP (no approval needed)
router.put(
  "/me/photo",
  authenticateToken,
  profileUpload.single("photo"),
  directUpdatePhoto
);
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
  getQRRequests,
);
router.post(
  "/qr-requests",
  authenticateToken,
  createQRRequest,
);
router.patch(
  "/qr-requests/:requestId/approve",
  authenticateToken,
  validateRbac([], ["superadmin", "hr_head", "hr_staff", "security_head"]),
  approveQRRequest,
);
router.patch(
  "/qr-requests/:requestId/reject",
  authenticateToken,
  validateRbac([], ["superadmin", "hr_head", "hr_staff", "security_head"]),
  rejectQRRequest,
);
router.patch(
  "/qr-requests/:requestId",
  authenticateToken,
  validateRbac([], ["superadmin", "hr_head", "security_head"]),
  editQRRequest,
);
router.delete(
  "/qr-requests/:requestId",
  authenticateToken,
  validateRbac([], ["superadmin"]),
  deleteQRRequest,
);

// R2: Suspension and Blocking routes
router.patch(
  "/:id/suspend",
  authenticateToken,
  validateRbac([], ["superadmin", "hr_head", "hr_staff", "security_head"]),
  suspendUser
);

router.patch(
  "/:id/block",
  authenticateToken,
  validateRbac([], ["superadmin", "hr_head", "hr_staff", "security_head"]),
  blockUser
);

router.patch(
  "/:id/unblock",
  authenticateToken,
  validateRbac([], ["superadmin", "hr_head", "security_head"]),
  unblockUser
);

export default router;
