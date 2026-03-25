import { Request, Response, type NextFunction } from "express";
import bcrypt from "bcryptjs";
import User from "../models/User";
import QRCode from "../models/QRCode";
import QRRequest from "../models/QRRequest";
import { generateQRString } from "../utils/qrUtils";
import { catchAsync } from "../utils/catchAsync";
import { AppError } from "../utils/AppError";
import { validationResult } from "express-validator";
interface AuthRequest extends Request {
  user?: any;
  file?: any;
}

const ADMIN_QR_FORMAT = /^(TUPM|TUPS|TUPV)-\d{2}-\d{4}$/;

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
      requestType: "QR",
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

export const requestProfilePhotoChange = async (
  req: AuthRequest,
  res: Response,
) => {
  const { reason } = req.body;

  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!req.file) {
      return res
        .status(400)
        .json({ message: "Please upload a new profile photo" });
    }

    const path = require("path");
    const relPath = path.relative(process.cwd(), req.file.path).replace(/\\/g, "/");

    const request = new QRRequest({
      userId: user._id,
      requestType: "PROFILE_PHOTO",
      reason: reason || "Profile photo update",
      oldPhotoURL: user.photoURL,
      newPhotoImage: `/${relPath}`,
    });

    await request.save();
    res.json({ message: "Profile photo change request submitted" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

export const getQRRequests = async (req: AuthRequest, res: Response) => {
  try {
    const requests = await QRRequest.find()
      .populate({
        path: "userId",
        select: "firstName surname role photoURL",
        options: { lean: true },
      })
      .lean();

    const userIds = Array.from(
      new Set(
        requests
          .map((r: any) => r.userId?._id?.toString())
          .filter((id: string | undefined): id is string => Boolean(id)),
      ),
    );

    const qrCodes = userIds.length
      ? await QRCode.find({ userId: { $in: userIds } })
          .select("userId qrString")
          .lean()
      : [];

    const qrMap = new Map(
      qrCodes.map((qr: any) => [qr.userId.toString(), qr.qrString]),
    );

    const enrichedRequests = requests.map((request: any) => {
      const user = request.userId;
      if (!user?._id) return request;
      return {
        ...request,
        userId: {
          ...user,
          qrString: qrMap.get(user._id.toString()) || null,
        },
      };
    });

    res.json(enrichedRequests);
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

    if (request.requestType === "PROFILE_PHOTO") {
      if (!request.newPhotoImage) {
        return res
          .status(400)
          .json({ message: "No uploaded photo found for this request" });
      }

      const userObj = await User.findById(request.userId);
      if (!userObj) {
        return res.status(404).json({ message: "User not found" });
      }

      userObj.photoURL = request.newPhotoImage;
      await userObj.save();
    } else {
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
    }

    request.status = "Approved";
    request.approvedBy = req.user.id;
    await request.save();

    res.json({
      message:
        request.requestType === "PROFILE_PHOTO"
          ? "Profile photo change approved"
          : "QR change approved",
    });
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
      .select(
        "_id firstName surname birthdate role staffType status photoURL email createdAt",
      )
      .lean();

    const userIds = users.map((user: any) => user._id.toString());
    const qrCodes = userIds.length
      ? await QRCode.find({ userId: { $in: userIds } })
          .select("userId qrString")
          .lean()
      : [];

    const qrMap = new Map(
      qrCodes.map((qr: any) => [qr.userId.toString(), qr.qrString]),
    );

    const usersWithQR = users.map((user: any) => ({
      ...user,
      qrString: qrMap.get(user._id.toString()) || null,
    }));

    res.status(200).json(usersWithQR);
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
        .json({ message: "Invalid QR format. Use TUPM/TUPS/TUPV-YY-XXXX." });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    const existingQR = await QRCode.findOne({ qrString: normalizedQR });
    if (existingQR) {
      return res.status(400).json({
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
      mustCapturePhoto: true,
    });

    await user.save();

    try {
      await new QRCode({ userId: user._id, qrString: normalizedQR }).save();
    } catch (qrError: any) {
      if (qrError?.code === 11000) {
        return res.status(400).json({
          message: "QR string already exists. Please use a unique value.",
        });
      }
      throw qrError;
    }

    res.status(201).json({ message: "User registered successfully" });
  } catch (error: any) {
    if (error?.code === 11000 && error?.keyPattern?.qrString) {
      return res.status(400).json({
        message: "QR string already exists. Please use a unique value.",
      });
    }

    console.error("Admin Register Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const completeFirstPhotoCapture = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { photoDataUrl } = req.body;

    if (!photoDataUrl || typeof photoDataUrl !== "string") {
      return next(new AppError("Photo capture is required", 400));
    }

    if (!photoDataUrl.startsWith("data:image/")) {
      return next(new AppError("Invalid photo format", 400));
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return next(new AppError("User not found", 404));
    }

    user.photoURL = photoDataUrl;
    user.mustCapturePhoto = false;
    await user.save();

    res.status(200).json({
      message: "Photo captured successfully",
      user: {
        _id: user._id.toString(),
        role: user.role,
        firstName: user.firstName,
        surname: user.surname,
        staffType: user.staffType,
        photoURL: user.photoURL,
        mustCapturePhoto: user.mustCapturePhoto,
      },
    });
  },
);
