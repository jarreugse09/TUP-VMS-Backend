import { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import User from "../models/User";
import QRRequest from "../models/QRRequest";
import PhotoUpdateRequest from "../models/PhotoUpdateRequest";
import ActionLog from "../models/ActionLog";
import { requireValidObjectId } from "../utils/validate";

interface AuthenticatedRequest extends Request {
  user?: {
    _id?: string;
    id?: string;
  };
}

const createArchiveRestoreLog = async (
  req: AuthenticatedRequest,
  targetModel: "User" | "QRRequest" | "PhotoUpdateRequest",
  targetId: string,
  type: string,
  reason: string,
) => {
  await ActionLog.create({
    performedBy: req.user?._id || req.user?.id || null,
    action: "ARCHIVE_RESTORED",
    targetModel,
    targetId,
    details: `Restored ${type} ID ${targetId}. Reason: ${reason}`,
    ipAddress: req.ip,
    userAgent: req.get("User-Agent") ?? "",
    severity: "warning",
  });
};

export const getArchivedRecords = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { type } = req.query;

    if (type === "users") {
      const records = await User.find({ status: { $in: ["Inactive", "Suspended"] } })
        .select("-passwordHash")
        .sort({ updatedAt: -1 });
      return res.status(200).json(records);
    }

    if (type === "qr_requests") {
      const records = await QRRequest.find({ status: "rejected" })
        .populate("userId", "firstName surname email role subRole photoURL")
        .populate("reviewedBy", "firstName surname")
        .sort({ updatedAt: -1 });
      return res.status(200).json(records);
    }

    if (type === "photo_requests") {
      const records = await PhotoUpdateRequest.find({ status: "rejected" })
        .populate("requesterId", "firstName surname email role subRole photoURL")
        .populate("reviewedBy", "firstName surname")
        .sort({ updatedAt: -1 });
      return res.status(200).json(records);
    }

    return res.status(400).json({ message: "Invalid type requested" });
  } catch (error) {
    console.error("Archive fetch error:", error);
    return res.status(500).json({ message: "Server error fetching archives" });
  }
};

export const restoreRecord = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { type, id } = req.params;
    const reason = typeof req.body.reason === "string" ? req.body.reason.trim() : "";

    if (!requireValidObjectId(id, res)) return;

    if (!reason) {
      return res.status(400).json({ error: "A restoration reason is required." });
    }

    if (type === "users") {
      const user = await User.findById(id);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      user.status = "Active";
      user.blockedAt = null;
      user.blockedReason = null;
      user.suspendedUntil = null;
      user.suspensionReason = null;
      user.qrCode = uuidv4();
      await user.save();

      await createArchiveRestoreLog(req, "User", String(user._id), type, reason);
      return res.status(200).json({ message: "User restored successfully", record: user });
    }

    if (type === "qr_requests") {
      const request = await QRRequest.findById(id);
      if (!request) {
        return res.status(404).json({ message: "QR Request not found" });
      }

      request.status = "approved";
      await request.save();

      const targetUser = await User.findById(request.userId);
      if (targetUser) {
        targetUser.qrCode = uuidv4();
        await targetUser.save();
      }

      await createArchiveRestoreLog(req, "QRRequest", String(request._id), type, reason);
      return res.status(200).json({ message: "QR Request approved successfully" });
    }

    if (type === "photo_requests") {
      const request = await PhotoUpdateRequest.findById(id);
      if (!request) {
        return res.status(404).json({ message: "Photo Request not found" });
      }

      request.status = "approved";
      await request.save();

      const targetUser = await User.findById(request.requesterId);
      if (targetUser) {
        targetUser.photoURL = request.newPhotoUrl;
        await targetUser.save();
      }

      await createArchiveRestoreLog(req, "PhotoUpdateRequest", String(request._id), type, reason);
      return res.status(200).json({ message: "Photo Request approved successfully" });
    }

    return res.status(400).json({ message: "Invalid restoration type" });
  } catch (error) {
    console.error("Archive restore error:", error);
    return res.status(500).json({ message: "Server error restoring record" });
  }
};
