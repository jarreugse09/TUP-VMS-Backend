import express, { Request, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import PhotoUpdateRequest from "../models/PhotoUpdateRequest";
import User from "../models/User";
import { authenticateToken, validateRbac } from "../middlewares/auth";
import { logAction } from "../utils/actionLogger";

const router = express.Router();
const buildProtectedPhotoUrl = (filename: string) => `/api/photo/${path.basename(filename)}`;

// Setup multer for photo uploads
const photoUploadDir = path.join(process.cwd(), "uploads", "photo-requests");
if (!fs.existsSync(photoUploadDir)) {
  fs.mkdirSync(photoUploadDir, { recursive: true });
}
const photoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, photoUploadDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const photoUpload = multer({
  storage: photoStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  },
});

// POST /api/photo-requests — submit new request (Student/Visitor only)
router.post(
  "/",
  authenticateToken,
  validateRbac(["Student", "Visitor"]),
  photoUpload.single("photo"),
  async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      if (!req.file) {
        return res.status(400).json({ message: "Photo file is required" });
      }

      // Check for existing pending request
      const existing = await PhotoUpdateRequest.findOne({
        requesterId: user.id,
        status: "pending",
        deletedAt: null,
      });
      if (existing) {
        return res
          .status(409)
          .json({ message: "You already have a pending photo update request" });
      }

      const newPhotoUrl = buildProtectedPhotoUrl(req.file.filename);
      const request = await PhotoUpdateRequest.create({
        requesterId: user.id,
        newPhotoUrl,
        status: "pending",
      });

      await logAction(req, "PHOTO_UPDATE_REQUESTED", "PhotoUpdateRequest", request._id, `Photo update request submitted`);
      return res.status(201).json({ message: "Photo update request submitted", data: request });
    } catch (error) {
      console.error("Photo request error:", error);
      return res.status(500).json({ message: "Server error" });
    }
  }
);

// GET /api/photo-requests — get all pending (security_staff, security_head, superadmin)
router.get(
  "/",
  authenticateToken,
  validateRbac([], ["security_staff", "security_head", "superadmin"]),
  async (req: Request, res: Response) => {
    try {
      const { status = "pending", page = 1, limit = 20 } = req.query;
      const skip = (Number(page) - 1) * Number(limit);

      const filter: Record<string, unknown> = { deletedAt: null };
      if (status !== "all") filter.status = status;

      const [requests, total] = await Promise.all([
        PhotoUpdateRequest.find(filter)
          .populate("requesterId", "firstName surname email role subRole photoURL")
          .populate("reviewedBy", "firstName surname")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(Number(limit)),
        PhotoUpdateRequest.countDocuments(filter),
      ]);

      return res.json({ data: requests, total, page: Number(page), limit: Number(limit) });
    } catch (error) {
      console.error("Get photo requests error:", error);
      return res.status(500).json({ message: "Server error" });
    }
  }
);

// GET /api/photo-requests/my — get own requests (any authenticated role)
router.get("/my", authenticateToken, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const requests = await PhotoUpdateRequest.find({
      requesterId: user.id,
      deletedAt: null,
    })
      .populate("reviewedBy", "firstName surname")
      .sort({ createdAt: -1 });

    return res.json({ data: requests });
  } catch (error) {
    console.error("Get my photo requests error:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

// PATCH /api/photo-requests/:id/approve
router.patch(
  "/:id/approve",
  authenticateToken,
  validateRbac([], ["security_staff", "security_head", "superadmin"]),
  async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const request = await PhotoUpdateRequest.findOne({
        _id: req.params.id,
        deletedAt: null,
      });

      if (!request) {
        return res.status(404).json({ message: "Request not found" });
      }

      // Update the request
      request.status = "approved";
      request.reviewedBy = user.id;
      request.reviewedAt = new Date();
      request.rejectionReason = null;
      await request.save();

      const targetUser = await User.findById(request.requesterId);
      if (!targetUser) {
        return res.status(404).json({ message: "Requester not found" });
      }

      targetUser.photoURL = request.newPhotoUrl;
      await targetUser.save();

      await logAction(req, "PHOTO_UPDATE_APPROVED", "PhotoUpdateRequest", request._id, `Photo update request approved for user ${request.requesterId}`);
      return res.json({ message: "Photo update request approved", data: request });
    } catch (error) {
      console.error("Approve photo request error:", error);
      return res.status(500).json({ message: "Server error" });
    }
  }
);

// PATCH /api/photo-requests/:id/reject
router.patch(
  "/:id/reject",
  authenticateToken,
  validateRbac([], ["security_staff", "security_head", "superadmin"]),
  async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const reason = req.body.reason?.trim();

      if (!reason) {
        return res.status(400).json({ message: "Rejection reason is required" });
      }

      const request = await PhotoUpdateRequest.findOne({
        _id: req.params.id,
        deletedAt: null,
      });

      if (!request) {
        return res.status(404).json({ message: "Request not found" });
      }

      request.status = "rejected";
      request.reviewedBy = user.id;
      request.reviewedAt = new Date();
      request.rejectionReason = reason;
      await request.save();

      await logAction(req, "PHOTO_UPDATE_REJECTED", "PhotoUpdateRequest", request._id, `Photo update request rejected: ${reason}`);
      return res.json({ message: "Photo update request rejected", data: request });
    } catch (error) {
      console.error("Reject photo request error:", error);
      return res.status(500).json({ message: "Server error" });
    }
  }
);

// PATCH /api/photo-requests/:id/resubmit
router.patch(
  "/:id/resubmit",
  authenticateToken,
  validateRbac([], ["superadmin"]),
  async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const request = await PhotoUpdateRequest.findOne({
        _id: req.params.id,
        deletedAt: null,
      });

      if (!request) {
        return res.status(404).json({ message: "Request not found" });
      }

      request.status = "pending";
      request.reviewedBy = user.id;
      request.reviewedAt = new Date();
      request.rejectionReason = null;
      await request.save();

      await logAction(req, "PHOTO_UPDATE_RESUBMITTED", "PhotoUpdateRequest", request._id, `Photo update request returned to pending`);
      return res.json({ message: "Photo update request moved back to pending", data: request });
    } catch (error) {
      console.error("Resubmit photo request error:", error);
      return res.status(500).json({ message: "Server error" });
    }
  }
);

// DELETE /api/photo-requests/:id — soft delete (superadmin only)
router.delete(
  "/:id",
  authenticateToken,
  validateRbac([], ["superadmin"]),
  async (req: Request, res: Response) => {
    try {
      const request = await PhotoUpdateRequest.findById(req.params.id);
      if (!request) return res.status(404).json({ message: "Request not found" });

      request.deletedAt = new Date();
      await request.save();

      await logAction(req, "PHOTO_REQUEST_DELETED", "PhotoUpdateRequest", request._id, `Photo update request soft-deleted`);
      return res.json({ message: "Photo update request deleted" });
    } catch (error) {
      console.error("Delete photo request error:", error);
      return res.status(500).json({ message: "Server error" });
    }
  }
);

export default router;
