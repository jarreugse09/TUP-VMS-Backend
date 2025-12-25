import { Request, Response } from "express";
import User from "../models/User";
import QRCode from "../models/QRCode";
import QRRequest from "../models/QRRequest";
import { generateQRString } from "../utils/qrUtils";

interface AuthRequest extends Request {
  user?: any;
}

export const getProfile = async (req: AuthRequest, res: Response) => {
  try {
    const user = await User.findById(req.user.id).select("-passwordHash");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const qrCode = await QRCode.findOne({ userId: user._id });

    res.json({ user, qrCode });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

export const requestQRChange = async (req: AuthRequest, res: Response) => {
  const { reason } = req.body;

  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const qrCode = await QRCode.findOne({ userId: user._id });
    if (!qrCode) {
      return res.status(404).json({ message: "QR code not found" });
    }

    const request = new QRRequest({
      userId: user._id,
      oldQR: qrCode.qrString,
      reason,
    });

    await request.save();

    res.json({ message: "QR change request submitted" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

export const getQRRequests = async (req: AuthRequest, res: Response) => {
  try {
    const requests = await QRRequest.find().populate(
      "userId",
      "firstName surname role"
    );
    res.json(requests);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

export const approveQRRequest = async (req: AuthRequest, res: Response) => {
  const { requestId } = req.params;

  try {
    const request = await QRRequest.findById(requestId);
    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }

    const qrCode = await QRCode.findOne({ userId: request.userId });
    if (!qrCode) {
      return res.status(404).json({ message: "QR code not found" });
    }

    // Generate new QR
    const newQRString = generateQRString(
      (await User.findById(request.userId))!.role
    );
    qrCode.qrString = newQRString;
    qrCode.updatedAt = new Date();
    await qrCode.save();

    request.status = "Approved";
    request.approvedBy = req.user.id;
    await request.save();

    res.json({ message: "QR change approved" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};
