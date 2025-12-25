import express from "express";
import {
  getProfile,
  requestQRChange,
  getQRRequests,
  approveQRRequest,
} from "../controllers/userController";
import { authenticateToken, authorizeRoles } from "../middlewares/auth";

const router = express.Router();

router.get("/profile", authenticateToken, getProfile);
router.post("/request-qr-change", authenticateToken, requestQRChange);
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

export default router;
