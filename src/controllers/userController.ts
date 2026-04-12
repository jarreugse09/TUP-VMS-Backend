import { Request, Response, type NextFunction } from "express";
import bcrypt from "bcryptjs";
import User from "../models/User";
import QRCode from "../models/QRCode";
import QRRequest from "../models/QRRequest";
import { generateQRString } from "../utils/qrUtils";
import { catchAsync } from "../utils/catchAsync";
import { AppError } from "../utils/AppError";
import { validationResult } from "express-validator";
import { resolveOrganizationRefs, resolveSupervisorId } from "../utils/orgStructure";
import { getScopedUserQuery } from "../utils/orgRbac";
import { logAction } from "../utils/actionLogger";
import path from "path";
import type { Types } from "mongoose";
import { requireValidObjectId } from "../utils/validate";
interface AuthRequest extends Request {
  user?: any;
  file?: any;
}

const ADMIN_QR_FORMAT = /^(TUPM|TUPS|TUPV)-\d{2}-\d{4}$/;
const NO_USER_RESULTS_FILTER = { _id: null };
const buildProtectedPhotoUrl = (filePath: string) =>
  `/api/photo/${path.basename(filePath)}`;

/**
 * Strict Silo Filter
 * - Dean: Faculty/Heads/Staff within own college. PROHIBITS Visitor, Student, Top Management.
 * - Dept Head: Faculty within own department.
 */
const getSiloedUserFilter = (reqUser: any) => {
  const subRole = reqUser.subRole?.toLowerCase();

  switch (subRole) {
    case "superadmin":
    case "hr_head":
    case "hr_staff":
      return {};
    case "dean":
      return reqUser.collegeId
        ? { collegeId: reqUser.collegeId }
        : NO_USER_RESULTS_FILTER;
    case "department_head":
      return reqUser.departmentId
        ? { departmentId: reqUser.departmentId }
        : NO_USER_RESULTS_FILTER;
    case "security_head":
      return {
        $or: [
          { role: { $in: ["Student", "Visitor"] } },
          { subRole: "security_staff" },
        ],
      };
    case "security_staff":
      return { role: { $in: ["Student", "Visitor"] } };
    case "top_management":
    case "faculty":
      return NO_USER_RESULTS_FILTER;
    default:
      return NO_USER_RESULTS_FILTER;
  }
};

/**
 * PUT /api/users/me/consent
 * DPA 2012 — Record informed consent for personal data processing.
 * Sets consentGiven = true and consentDate = now on the authenticated user.
 */
export const recordConsent = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const user = await User.findById(req.user.id || req.user._id);
    if (!user) return next(new AppError("User not found", 404));

    if (user.consentGiven) {
      return res.status(200).json({
        message: "Consent already recorded",
        user: { consentGiven: true, consentDate: user.consentDate },
      });
    }

    user.consentGiven = true;
    user.consentDate = new Date();
    user.updatedAt = new Date();
    await user.save();

    await logAction(req, "USER_CONSENT_GIVEN", "User", user._id, "User gave DPA 2012 consent");

    res.status(200).json({
      message: "Consent recorded successfully",
      user: {
        _id: user._id,
        consentGiven: user.consentGiven,
        consentDate: user.consentDate,
        role: user.role,
        subRole: user.subRole,
        firstName: user.firstName,
        surname: user.surname,
        photoURL: user.photoURL,
        mustCapturePhoto: user.mustCapturePhoto,
      },
    });
  }
);


export const getProfile = async (req: AuthRequest, res: Response) => {
  try {
    const user = await User.findById(req.user.id).select("-passwordHash");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({ user, qrCode: { qrString: user.qrCode } });
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

    if (!newQRString && !req.file) {
      return res.status(400).json({ message: "Please provide a new QR string or upload an image" });
    }

    const path = require("path");
    const relPath = req.file
      ? path.relative(process.cwd(), req.file.path).replace(/\\/g, "/")
      : undefined;

    // Auto-approve logic for HR Head & Superadmin
    const subRole = req.user.subRole?.toLowerCase();
    const isAutoApprove = subRole === "hr_head" || subRole === "superadmin";

    if (isAutoApprove) {
      const generatedQrString = newQRString || generateQRString(user.role);
      qrCode.qrString = generatedQrString;
      qrCode.updatedAt = new Date();
      await qrCode.save();

      const request = new QRRequest({
        userId: user._id,
        requestType: "QR",
        oldQR: qrCode.qrString,
        reason,
        newQRString: generatedQrString,
        newQRImage: relPath ? `/${relPath}` : undefined,
        status: "Approved",
        approvedBy: user._id,
        reviewedBy: user._id,
        reviewedAt: new Date()
      });
      await request.save();

      await logAction(req, "QR_CHANGE_AUTO_APPROVED", "QRRequest", request._id, `QR change auto-approved for reason: ${reason}`);
      return res.json({ message: "QR change auto-approved", autoApproved: true, newQrCode: generatedQrString });
    }

    const request = new QRRequest({
      userId: user._id,
      requestType: "QR",
      oldQR: qrCode.qrString,
      reason,
      newQRString: newQRString || undefined,
      newQRImage: relPath ? `/${relPath}` : undefined,
    });

    await request.save();

    await logAction(req, "QR_CHANGE_REQUESTED", "QRRequest", request._id, `QR change requested for reason: ${reason}`);

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

    const request = new QRRequest({
      userId: user._id,
      requestType: "PROFILE_PHOTO",
      reason: reason || "Profile photo update",
      oldPhotoURL: user.photoURL,
      newPhotoImage: buildProtectedPhotoUrl(req.file.path),
    });

    await request.save();

    await logAction(req, "PHOTO_CHANGE_REQUESTED", "QRRequest", request._id, `Profile photo change requested`);
    res.json({ message: "Profile photo change request submitted" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

export const getQRRequests = async (req: AuthRequest, res: Response) => {
  try {
    const callerSubRole = req.user.subRole?.toLowerCase();
    
    // First, fetch all active requests
    const allRequests = await QRRequest.find({ isDeleted: { $ne: true } })
      .populate({
        path: "userId",
        select: "firstName surname role subRole photoURL",
        options: { lean: true },
      })
      .lean();

    // In-memory scoping based on caller
    let requests = allRequests;
    if (callerSubRole !== "superadmin") {
      requests = allRequests.filter((request: any) => {
        const target = request.userId;
        if (!target) return false;

        switch (callerSubRole) {
          case "hr_head":
            return ["Staff", "TUP"].includes(target.role);
          case "hr_staff":
            return ["Staff", "TUP"].includes(target.role) && !["hr_head", "superadmin"].includes(target.subRole?.toLowerCase());
          case "security_head":
            return ["Student", "Visitor"].includes(target.role) || target.subRole?.toLowerCase() === "security_staff";
          case "security_staff":
            return ["Student", "Visitor"].includes(target.role);
          default:
            return target._id?.toString() === req.user.id || target._id?.toString() === req.user._id;
        }
      });
    }

    const userIds = Array.from(
      new Set(
        requests
          .map((r: any) => r.userId?._id?.toString())
          .filter((id: string | undefined): id is string => Boolean(id)),
      ),
    );

    const qrCodes = userIds.length
      ? await QRCode.find({ userId: { $in: userIds } }).select("userId qrString").lean()
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

export const createQRRequest = async (req: AuthRequest, res: Response) => {
  const reason = req.body.reason?.trim();

  if (!reason) {
    return res.status(400).json({ message: "Reason is required" });
  }

  try {
    const user = await User.findById(req.user.id || req.user._id).select("_id qrCode");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const request = await QRRequest.create({
      userId: user._id,
      requestType: "QR",
      oldQR: user.qrCode,
      reason,
      status: "pending",
    });

    await logAction(req, "QR_CHANGE_REQUESTED", "QRRequest", request._id, `QR change requested for reason: ${reason}`);
    return res.status(201).json({ message: "QR request submitted", data: request });
  } catch (error) {
    return res.status(500).json({ message: "Server error" });
  }
};

import { v4 } from "uuid";

export const approveQRRequest = async (req: AuthRequest, res: Response) => {
  const { requestId } = req.params;

  try {
    const request = await QRRequest.findById(requestId);
    if (!request || request.isDeleted) {
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

      // Generate UUIDv4 or use provided
      const userObj = await User.findById(request.userId);
      const newQRString = request.newQRString || v4();

      qrCode.qrString = newQRString;
      qrCode.updatedAt = new Date();
      await qrCode.save();

      if (userObj) {
        userObj.qrCode = newQRString;
        await userObj.save();
      }
    }

    request.status = "Approved";
    request.reviewedBy = req.user.id || req.user._id;
    request.reviewedAt = new Date();
    request.approvedBy = req.user.id; // legacy
    await request.save();

    await logAction(req, "QR_REQUEST_APPROVED", "QRRequest", request._id, `Approved QR/Photo request for user ${request.userId}`);

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
  const reason = req.body.reason?.trim();

  if (!reason) {
    return res.status(400).json({ message: "A rejection reason is required" });
  }

  try {
    const request = await QRRequest.findById(requestId);
    if (!request || request.isDeleted) {
      return res.status(404).json({ message: "Request not found" });
    }

    request.status = "Rejected";
    request.reason = reason;
    request.reviewedBy = req.user.id || req.user._id;
    request.reviewedAt = new Date();
    request.approvedBy = req.user.id; // legacy
    await request.save();

    await logAction(req, "QR_REQUEST_REJECTED", "QRRequest", request._id, `Rejected QR/Photo request for user ${request.userId}`);

    res.json({ message: "QR change request rejected" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

export const editQRRequest = async (req: AuthRequest, res: Response) => {
  const { requestId } = req.params;
  const { status, reason } = req.body; // allow changing status/reason directly
  
  try {
    const request = await QRRequest.findById(requestId);
    if (!request || request.isDeleted) {
      return res.status(404).json({ message: "Request not found" });
    }

    if (status) request.status = status;
    if (reason) request.reason = reason;
    await request.save();

    await logAction(req, "QR_REQUEST_MODIFIED", "QRRequest", request._id, `Modified QR request ${requestId}`);
    res.json({ message: "QR request modified", data: request });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

export const deleteQRRequest = async (req: AuthRequest, res: Response) => {
  const { requestId } = req.params;
  
  try {
    const request = await QRRequest.findById(requestId);
    if (!request || request.isDeleted) {
      return res.status(404).json({ message: "Request not found" });
    }

    request.isDeleted = true;
    request.deletedAt = new Date();
    await request.save();

    await logAction(req, "QR_REQUEST_DELETED", "QRRequest", request._id, `Soft-deleted QR request ${requestId}`);
    res.json({ message: "QR request deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

export const getAllUsers = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthRequest;
    const { role, name, startDate, endDate, college, department } = req.query;

    const queryParts: any[] = [];
    queryParts.push(await getScopedUserQuery(authReq.user, {
      includeSubordinates: true,
    }));

    // Apply strict silo for Deans/Dept Heads
    if (["dean", "department_head"].includes(authReq.user.subRole?.toLowerCase())) {
        queryParts.push(getSiloedUserFilter(authReq.user));
    }

    if (role) queryParts.push({ role });
    if (college) queryParts.push({ college });
    if (department) queryParts.push({ department });
    if (name) {
      queryParts.push({
        $or: [
        { firstName: { $regex: new RegExp(name as string, "i") } },
        { surname: { $regex: new RegExp(name as string, "i") } },
        ],
      });
    }
    if (startDate || endDate) {
      const createdAt: any = {};
      if (startDate) createdAt.$gte = new Date(startDate as string);
      if (endDate) createdAt.$lte = new Date(endDate as string);
      queryParts.push({ createdAt });
    }
    const query: any =
      queryParts.length === 1 ? queryParts[0] : { $and: queryParts };

    const users = await User.find(query)
      .populate({
        path: "supervisorId",
        select: "firstName surname email role subRole",
        options: { lean: true },
      })
      .select(
        "_id firstName surname birthdate role subRole staffType designation officeUnit college collegeId department departmentId supervisorId workScheduleId status photoURL email createdAt",
      )
      .lean();

    // Returns only explicitly selected non-sensitive user data.
    res.status(200).json(users);
  },
);

export const getUserById = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { id } = req.params;
    if (!requireValidObjectId(id, res)) return;
    const user = await User.findById(id)
      .populate({
        path: "supervisorId",
        select: "firstName surname email role subRole",
        options: { lean: true },
      })
      .select("-passwordHash -qrCode")
      .lean();

    if (!user) return next(new AppError("User not found", 404));

    // ── Silo Guard ──────────────────────────────────────────────────────────
    const subRole = req.user.subRole?.toLowerCase();
    if (["dean", "department_head"].includes(subRole)) {
      const filter = getSiloedUserFilter(req.user) as any;
      const targetSubRole = user.subRole?.toLowerCase() || "";
      
      let matchesSilo = false;
      if (subRole === "dean") {
        matchesSilo = 
          user.collegeId?.toString() === req.user.collegeId?.toString() && 
          user.role === "TUP" && 
          filter.subRole?.$in?.includes(targetSubRole);
      } else if (subRole === "department_head") {
        matchesSilo = 
          user.departmentId?.toString() === req.user.departmentId?.toString() && 
          user.role === "TUP" && 
          filter.subRole?.$in?.includes(targetSubRole);
      }

      if (!matchesSilo) {
        return res.status(403).json({ message: "Forbidden: Access restricted to your organizational silo." });
      }
    }

    res.status(200).json(user);
  }
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
      subRole,
      staffType,
      designation,
      officeUnit,
      college,
      department,
      supervisorEmail,
      password,
      customQR,
      photoURL,
    } = req.body;

    // RBAC: Only HR Head or Superadmin can assign Dean/Dept Head roles
    const elevatedRoles = ["top_management", "dean", "department_head"];
    if (subRole && elevatedRoles.includes(subRole.toLowerCase())) {
        const isHrHead = req.user.subRole?.toLowerCase() === "hr_head";
        const isSuperAdmin = req.user.role === "TUP" && (!req.user.subRole || ["superadmin", "admin"].includes(req.user.subRole.toLowerCase()));
        if (!isHrHead && !isSuperAdmin) {
            return res.status(403).json({ message: "Forbidden: Only HR Head can assign Leadership roles." });
        }
    }

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

    const passwordHash = await bcrypt.hash(password, 12);
    const orgRefs = await resolveOrganizationRefs({ college, department });
    const supervisorId = await resolveSupervisorId({ supervisorEmail });

    const user = new User({
      firstName,
      surname,
      birthdate,
      role,
      subRole: subRole || undefined,
      staffType: role === "Staff" ? staffType : undefined,
      designation: designation?.trim() || undefined,
      officeUnit: officeUnit?.trim() || undefined,
      college: orgRefs.college,
      collegeId: orgRefs.collegeId,
      department: orgRefs.department,
      departmentId: orgRefs.departmentId,
      supervisorId,
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

    await logAction(req, "USER_REGISTERED", "User", user._id, `User registered by admin with role: ${user.role}`);

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

export const suspendUser = catchAsync(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const { suspendedUntil, suspensionReason } = req.body;
  const targetId = req.params.id;
  const caller = req.user;

  if (!requireValidObjectId(targetId, res)) return;

  if (!suspendedUntil || !suspensionReason) {
    return next(new AppError("suspendedUntil and suspensionReason are required", 400));
  }

  if (new Date(suspendedUntil) <= new Date()) {
    return next(new AppError("suspendedUntil must be in the future", 400));
  }

  const targetUser = await User.findById(targetId);
  if (!targetUser) return next(new AppError("User not found", 404));

  // Access control
  if (caller.subRole === "superadmin" && targetUser.subRole === "superadmin") {
    return next(new AppError("Superadmin cannot suspend another superadmin", 403));
  }
  
  if (["hr_head", "hr_staff"].includes(caller.subRole)) {
    if (!["Staff", "TUP"].includes(targetUser.role)) {
      return next(new AppError("HR can only suspend Staff/TUP users", 403));
    }
    if (["superadmin", "hr_head", "dean", "top_management"].includes(targetUser.subRole || "")) {
      return next(new AppError("HR cannot suspend this sub-role", 403));
    }
  }

  if (caller.subRole === "security_head") {
    if (!["Student", "Visitor"].includes(targetUser.role) && targetUser.subRole !== "security_staff") {
      return next(new AppError("Security head can only suspend students, visitors, or security staff", 403));
    }
  }

  targetUser.status = "Suspended";
  targetUser.suspendedUntil = new Date(suspendedUntil);
  targetUser.suspensionReason = suspensionReason;
  await targetUser.save();

  await logAction(req, "USER_SUSPENDED", "User", targetUser._id, `Suspended until ${suspendedUntil}. Reason: ${suspensionReason}`);

  const updatedUser: any = targetUser.toObject();
  delete updatedUser.passwordHash;
  delete updatedUser.qrCode;

  res.status(200).json({ message: "User suspended successfully", data: updatedUser });
});

export const blockUser = catchAsync(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const { blockedReason } = req.body;
  const targetId = req.params.id;
  const caller = req.user;

  if (!requireValidObjectId(targetId, res)) return;

  if (!blockedReason) {
    return next(new AppError("blockedReason is required", 400));
  }

  const targetUser = await User.findById(targetId);
  if (!targetUser) return next(new AppError("User not found", 404));

  // Access control
  if (caller.subRole === "superadmin" && targetUser.subRole === "superadmin") {
    return next(new AppError("Superadmin cannot block another superadmin", 403));
  }
  
  if (["hr_head", "hr_staff"].includes(caller.subRole)) {
    if (!["Staff", "TUP"].includes(targetUser.role)) {
      return next(new AppError("HR can only block Staff/TUP users", 403));
    }
    if (["superadmin", "hr_head", "dean", "top_management"].includes(targetUser.subRole || "")) {
      return next(new AppError("HR cannot block this sub-role", 403));
    }
  }

  if (caller.subRole === "security_head") {
    if (!["Student", "Visitor"].includes(targetUser.role) && targetUser.subRole !== "security_staff") {
      return next(new AppError("Security head can only block students, visitors, or security staff", 403));
    }
  }

  targetUser.status = "Blocked";
  targetUser.blockedReason = blockedReason;
  targetUser.blockedAt = new Date();
  await targetUser.save();

  await logAction(req, "USER_BLOCKED", "User", targetUser._id, `Blocked. Reason: ${blockedReason}`);

  const updatedUser: any = targetUser.toObject();
  delete updatedUser.passwordHash;
  delete updatedUser.qrCode;

  res.status(200).json({ message: "User blocked successfully", data: updatedUser });
});

export const unblockUser = catchAsync(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const targetId = req.params.id;
  const caller = req.user;

  if (!requireValidObjectId(targetId, res)) return;

  const targetUser = await User.findById(targetId);
  if (!targetUser) return next(new AppError("User not found", 404));

  // Access control
  if (caller.subRole === "superadmin" && targetUser.subRole === "superadmin") {
    return next(new AppError("Superadmin cannot unblock another superadmin", 403));
  }
  
  if (caller.subRole === "hr_head") {
    if (!["Staff", "TUP"].includes(targetUser.role)) {
      return next(new AppError("HR can only unblock Staff/TUP users", 403));
    }
    if (["superadmin", "dean", "top_management"].includes(targetUser.subRole || "")) {
      return next(new AppError("HR cannot unblock this sub-role", 403));
    }
  }

  if (caller.subRole === "security_head") {
    if (!["Student", "Visitor"].includes(targetUser.role) && targetUser.subRole !== "security_staff") {
      return next(new AppError("Security head can only unblock students, visitors, or security staff", 403));
    }
  }

  targetUser.status = "Active";
  targetUser.blockedReason = null;
  targetUser.blockedAt = null;
  targetUser.suspendedUntil = null;
  targetUser.suspensionReason = null;
  await targetUser.save();

  await logAction(req, "USER_UNBLOCKED", "User", targetUser._id, `User unblocked/unsuspended`);

  const updatedUser: any = targetUser.toObject();
  delete updatedUser.passwordHash;
  delete updatedUser.qrCode;

  res.status(200).json({ message: "User unblocked successfully", data: updatedUser });
});

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

    await logAction(req, "PHOTO_CAPTURED", "User", user._id, "Completed first photo capture");

    res.status(200).json({
      message: "Photo captured successfully",
      user: {
        _id: user._id.toString(),
        role: user.role,
        subRole: user.subRole,
        firstName: user.firstName,
        surname: user.surname,
        staffType: user.staffType,
        designation: user.designation,
        officeUnit: user.officeUnit,
        college: user.college,
        department: user.department,
        supervisorId: user.supervisorId,
        workScheduleId: user.workScheduleId,
        photoURL: user.photoURL,
        mustCapturePhoto: user.mustCapturePhoto,
      },
    });
  },
);

/**
 * PUT /api/users/me/photo — Direct photo update for Staff/TUP roles.
 * No approval needed. Student/Visitor must use the photo-requests endpoint.
 */
export const directUpdatePhoto = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    // Only Staff/TUP allowed — Student/Visitor must go through photo-requests
    if (user.role === "Student" || user.role === "Visitor") {
      res.status(403).json({ message: "Students and Visitors must submit a photo update request for approval." });
      return;
    }

    if (!req.file) {
      res.status(400).json({ message: "Photo file is required" });
      return;
    }

    const photoUrl = buildProtectedPhotoUrl(req.file.path);

    user.photoURL = photoUrl;
    await user.save();

    await logAction(req, "PHOTO_DIRECT_UPDATED", "User", user._id, "User directly updated their profile photo");

    res.status(200).json({ message: "Profile photo updated successfully", photoURL: photoUrl });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};
