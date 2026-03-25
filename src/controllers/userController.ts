import { Request, Response, type NextFunction } from "express";
import bcrypt from "bcryptjs";
import User from "../models/User";
import QRCode from "../models/QRCode";
import QRRequest from "../models/QRRequest";
import { generateQRString } from "../utils/qrUtils";
import { catchAsync } from "../utils/catchAsync";
import { validationResult } from "express-validator";
interface AuthRequest extends Request {
  user?: any;
  file?: any;
}

const ADMIN_QR_FORMAT = /^TUP-\d{2}-\d{4}$/;

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
  const { reason, newQRString } = req.body;

  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const qrCode = await QRCode.findOne({ userId: user._id });
    if (!qrCode) {
      return res.status(404).json({ message: "QR code not found" });
    }

    // Require either a newQRString or an uploaded image to accept a change request
    if (!newQRString && !req.file) {
      return res
        .status(400)
        .json({ message: "Please provide a new QR string or upload an image" });
    }

    const path = require("path");
    const relPath = req.file
      ? path.relative(process.cwd(), req.file.path).replace(/\\/g, "/")
      : undefined;

    const request = new QRRequest({
      userId: user._id,
      oldQR: qrCode.qrString,
      reason,
      newQRString: newQRString || undefined,
      newQRImage: relPath ? `/${relPath}` : undefined,
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
      "firstName surname role",
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

    // Use the user's supplied QR string if present, otherwise generate a new one
    const userObj = await User.findById(request.userId);
    const newQRString = request.newQRString || generateQRString(userObj!.role);

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

export const rejectQRRequest = async (req: AuthRequest, res: Response) => {
  const { requestId } = req.params;

  try {
    const request = await QRRequest.findById(requestId);
    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }

    request.status = "Rejected";
    request.approvedBy = req.user.id; // record who rejected
    await request.save();

    res.json({ message: "QR change request rejected" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

export const getAllUsers = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { role, name, startDate, endDate } = req.query;

    // Build query
    const query: any = {};

    if (role) query.role = role;
    if (name) {
      query.$or = [
        { firstName: { $regex: new RegExp(name as string, "i") } },
        { surname: { $regex: new RegExp(name as string, "i") } },
      ];
    }
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate as string);
      if (endDate) query.createdAt.$lte = new Date(endDate as string);
    }

    const users = await User.find(query)
      .select("_id firstName surname birthdate role status photoURL createdAt")
      .lean();

    res.status(200).json(users);
  },
);

export const adminRegisterUser = async (req: AuthRequest, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const email = req.body.email?.trim().toLowerCase();
    const {
      firstName,
      surname,
      birthdate,
      role,
      staffType,
      password,
      customQR,
      photoURL,
    } = req.body;

    const normalizedQR = customQR?.trim();
    if (!ADMIN_QR_FORMAT.test(normalizedQR || "")) {
      return res
        .status(400)
        .json({ message: "Invalid QR format. Use TUP-YY-XXXX." });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    const existingQR = await QRCode.findOne({ qrString: normalizedQR });
    if (existingQR) {
      return res
        .status(400)
        .json({
          message: "QR string already exists. Please use a unique value.",
        });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = new User({
      firstName,
      surname,
      birthdate,
      role,
      staffType: role === "Staff" ? staffType : undefined,
      email,
      passwordHash,
      photoURL: photoURL || "https://placehold.co/200x200?text=TUP+VMS",
    });

    await user.save();

    try {
      await new QRCode({ userId: user._id, qrString: normalizedQR }).save();
    } catch (qrError: any) {
      if (qrError?.code === 11000) {
        return res
          .status(400)
          .json({
            message: "QR string already exists. Please use a unique value.",
          });
      }
      throw qrError;
    }

    res.status(201).json({ message: "User registered successfully" });
  } catch (error: any) {
    if (error?.code === 11000 && error?.keyPattern?.qrString) {
      return res
        .status(400)
        .json({
          message: "QR string already exists. Please use a unique value.",
        });
    }

    console.error("Admin Register Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};
