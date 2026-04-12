import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User";
import QRCode from "../models/QRCode";
import { generateQRString } from "../utils/qrUtils";
import { validationResult } from "express-validator";
import { resolveOrganizationRefs, resolveSupervisorId } from "../utils/orgStructure";
import { logAction } from "../utils/actionLogger";
import ActionLog from "../models/ActionLog";
import { getManilaTime } from "../utils/dateUtils";
import { v4 as uuidv4 } from "uuid";
import type { IUser } from "../models/User";
import type { JwtPayload } from "jsonwebtoken";

interface ScopedRegisterBody {
  firstName?: string;
  surname?: string;
  birthdate?: string;
  email?: string;
  password?: string;
  consentGiven?: boolean;
  designation?: string;
  collegeId?: string;
  departmentId?: string;
  photoURL?: string;
  subRole?: string;
}

interface ScopedRegisterResponse {
  message: string;
  user: {
    id: IUser["_id"];
    email: string;
    role: string;
    subRole?: string | null;
  };
  qrCode?: string;
}

interface SuperadminTokenPayload extends JwtPayload {
  subRole?: string;
}

// Reusable scoped registration helper
const handleScopedRegister = async (
  req: Request<unknown, unknown, ScopedRegisterBody>,
  res: Response,
  role: string,
  subRole: string | null = null,
  extraValidator?: (body: ScopedRegisterBody) => string | null,
  returnQr = false,
) => {
  try {
    const { firstName, surname, birthdate, email: rawEmail, password, consentGiven, designation, collegeId, departmentId } = req.body;
    
    if (!firstName || !surname || !birthdate || !rawEmail || !password) {
      return res.status(400).json({ message: "Missing required fields" });
    }
    if (consentGiven !== true) {
      return res.status(400).json({ message: "DPA 2012 Consent is required" });
    }
    if (extraValidator) {
      const err = extraValidator(req.body);
      if (err) return res.status(400).json({ message: err });
    }

    const email = rawEmail.trim().toLowerCase();
    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ message: "User already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const qrCode = uuidv4();

    const user = new User({
      firstName,
      surname,
      birthdate,
      role,
      subRole: subRole || undefined,
      email,
      passwordHash,
      qrCode,
      consentGiven: true,
      consentDate: new Date(),
      photoURL: req.body.photoURL || "/default-avatar.png",
      designation: designation || undefined,
      collegeId: collegeId || undefined,
      departmentId: departmentId || undefined,
    });

    await user.save();
    await logAction(req, "USER_REGISTERED_SCOPED", "User", user._id, `Registered user ${email} with role ${role}/${subRole}`);

    const responseData: ScopedRegisterResponse = { message: "User registered successfully", user: { id: user._id, email: user.email, role: user.role, subRole: user.subRole } };
    if (returnQr) {
      responseData.qrCode = qrCode; // allow user to save their QR
    }

    return res.status(201).json(responseData);
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("Scoped Registration Error:", err);
    return res.status(500).json({ message: "Server error", error: errorMessage });
  }
};

const formatManilaDateTime = (value: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    dateStyle: "short",
    timeStyle: "short",
    hour12: false,
    timeZone: "Asia/Manila",
  }).format(value);

const createAuthFailureLog = async (
  req: Request,
  action: "LOGIN_FAILED" | "LOGIN_BLOCKED",
  details: string,
  performedBy?: string | null,
  targetId?: string | null,
  severity: "warning" | "critical" = "warning",
) => {
  await ActionLog.create({
    performedBy: performedBy ?? null,
    action,
    targetModel: "User",
    targetId: targetId ?? null,
    details,
    severity,
    ipAddress: req.ip,
    userAgent: req.get("User-Agent") ?? "",
  });
};

const buildAccessToken = (user: IUser) =>
  jwt.sign(
    {
      id: user._id,
      _id: user._id,
      role: user.role,
      subRole: user.subRole,
      staffType: user.staffType,
      designation: user.designation,
      officeUnit: user.officeUnit,
      college: user.college,
      collegeId: user.collegeId,
      department: user.department,
      departmentId: user.departmentId,
      supervisorId: user.supervisorId,
      workScheduleId: user.workScheduleId,
      firstName: user.firstName,
      surname: user.surname,
      name: `${user.firstName} ${user.surname}`,
    },
    process.env.JWT_SECRET!,
    { expiresIn: "15m" },
  );

const issueRefreshToken = async (user: IUser) => {
  const refreshToken = jwt.sign(
    {
      id: user._id,
      type: "refresh",
    },
    process.env.JWT_SECRET!,
    { expiresIn: "7d" },
  );

  user.refreshTokenHash = await bcrypt.hash(refreshToken, 12);
  user.refreshTokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await user.save();

  return refreshToken;
};

export const registerStudentVisitor = async (req: Request, res: Response) => {
  const { role } = req.body;
  if (!["Student", "Visitor"].includes(role)) {
    return res.status(400).json({ message: "Role must be Student or Visitor" });
  }
  return handleScopedRegister(req, res, role, null, undefined, true);
};

export const registerFaculty = async (req: Request, res: Response) => {
  return handleScopedRegister(req, res, "Staff", "faculty", (body) => (!body.departmentId || !body.collegeId ? "departmentId and collegeId required" : null), true);
};

export const registerDepartmentHead = async (req: Request, res: Response) => {
  return handleScopedRegister(req, res, "TUP", "department_head", (body) => (!body.departmentId || !body.collegeId ? "departmentId and collegeId required" : null));
};

export const registerDean = async (req: Request, res: Response) => {
  return handleScopedRegister(req, res, "TUP", "dean", (body) => (!body.collegeId ? "collegeId required" : null));
};

export const registerTopManagement = async (req: Request, res: Response) => {
  return handleScopedRegister(req, res, "TUP", "top_management");
};

export const registerNonAcademic = async (req: Request, res: Response) => {
  return handleScopedRegister(req, res, "TUP", "non_academic");
};

export const registerSuperadmin = async (req: Request, res: Response) => {
  const existingSuperadmin = await User.findOne({ subRole: "superadmin" });
  if (existingSuperadmin) {
    const authHeader = req.headers["authorization"];
    if (!authHeader) return res.status(401).json({ message: "Access token required" });
    const token = authHeader.split(" ")[1];
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as SuperadminTokenPayload;
      if (decoded.subRole !== "superadmin") {
        return res.status(403).json({ message: "Only an existing superadmin can create a new superadmin" });
      }
      Object.assign(req, { user: decoded }); // for logAction
    } catch (e) {
      return res.status(403).json({ message: "Invalid or expired token" });
    }
  }
  return handleScopedRegister(req, res, "TUP", "superadmin");
};

export const registerHr = async (req: Request, res: Response) => {
  const { subRole } = req.body;
  if (!["hr_head", "hr_staff"].includes(subRole)) {
    return res.status(400).json({ message: "subRole must be hr_head or hr_staff" });
  }
  // From user prompt: hr_head and hr_staff are under role "TUP" per CLAUDE.md taxonomy
  return handleScopedRegister(req, res, "TUP", subRole);
};

export const registerSecurity = async (req: Request, res: Response) => {
  const { subRole } = req.body;
  if (!["security_head", "security_staff"].includes(subRole)) {
    return res.status(400).json({ message: "subRole must be security_head or security_staff" });
  }
  // From user prompt: security_head / security_staff role is Staff (Wait, CLAUDE.md actually says security is Staff. Let me be safe and use "Staff")
  return handleScopedRegister(req, res, "Staff", subRole);
};

export const refreshAccessToken = async (req: Request, res: Response) => {
  try {
    const refreshToken = req.body.refreshToken?.trim();
    if (!refreshToken) {
      return res.status(400).json({ message: "Refresh token is required" });
    }

    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET!) as {
      id?: string;
      _id?: string;
      type?: string;
    };
    if (decoded.type !== "refresh") {
      return res.status(403).json({ message: "Invalid refresh token" });
    }

    const userId = decoded.id ?? decoded._id;
    const user = await User.findById(userId)
      .select("+refreshTokenHash +passwordHash");

    if (!user || !user.refreshTokenHash || !user.refreshTokenExpiresAt) {
      return res.status(403).json({ message: "Invalid refresh token" });
    }

    if (user.refreshTokenExpiresAt < new Date()) {
      user.refreshTokenHash = null;
      user.refreshTokenExpiresAt = null;
      await user.save();
      return res.status(403).json({ message: "Refresh token expired" });
    }

    const matches = await bcrypt.compare(refreshToken, user.refreshTokenHash);
    if (!matches) {
      return res.status(403).json({ message: "Invalid refresh token" });
    }

    const accessToken = buildAccessToken(user);
    const nextRefreshToken = await issueRefreshToken(user);

    return res.json({
      token: accessToken,
      refreshToken: nextRefreshToken,
    });
  } catch (error) {
    return res.status(403).json({ message: "Invalid refresh token" });
  }
};

// ===== Login =====
export const login = async (req: Request, res: Response) => {
  try {
    // Log the request body for debugging on Render
    // console.log("REQ BODY:", req.body);

    // Normalize email
    const email = req.body.email?.trim().toLowerCase();
    const password = req.body.password;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required" });
    }

    // Find user
    const user = await User.findOne({ email }).select(
      "+passwordHash +refreshTokenHash",
    );
    if (!user) {
      await createAuthFailureLog(
        req,
        "LOGIN_FAILED",
        `Failed login for email: ${req.body.email ?? "unknown"}`,
      );
      return res.status(400).json({ message: "Invalid email or password" });
    }

    // Compare password
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      await createAuthFailureLog(
        req,
        "LOGIN_FAILED",
        `Failed login for email: ${req.body.email ?? "unknown"}`,
        null,
        null,
      );
      return res.status(400).json({ message: "Invalid email or password" });
    }

    if (
      user.status === "Suspended" &&
      user.suspendedUntil &&
      new Date() > user.suspendedUntil
    ) {
      user.status = "Active";
      user.suspendedUntil = null;
      user.suspensionReason = null;
      await user.save();
    }

    if (user.status === "Suspended") {
      const error = `Login denied - account suspended until ${user.suspendedUntil ? formatManilaDateTime(user.suspendedUntil) : "unknown"}`;
      await createAuthFailureLog(
        req,
        "LOGIN_BLOCKED",
        error,
        user._id.toString(),
        user._id.toString(),
      );
      return res.status(403).json({ error });
    }

    if (user.status === "Blocked") {
      const error = `Login denied - account permanently blocked. Reason: ${user.blockedReason ?? "Contact administrator."}`;
      await createAuthFailureLog(
        req,
        "LOGIN_BLOCKED",
        error,
        user._id.toString(),
        user._id.toString(),
        "critical",
      );
      return res.status(403).json({ error });
    }

    if (user.status === "Inactive") {
      const error = "Account is inactive.";
      await createAuthFailureLog(req, "LOGIN_BLOCKED", error, user._id.toString());
      return res.status(403).json({ error });
    }

    const token = buildAccessToken(user);
    const refreshToken = await issueRefreshToken(user);

    res.json({
      token,
      refreshToken,
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
        collegeId: user.collegeId,
        department: user.department,
        departmentId: user.departmentId,
        supervisorId: user.supervisorId,
        workScheduleId: user.workScheduleId,
        photoURL: user.photoURL,
        mustCapturePhoto: user.mustCapturePhoto,
        // DPA 2012 — required by frontend DpaConsentGate on first login
        consentGiven: user.consentGiven,
        consentDate: user.consentDate ?? null,
      },
    });
  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};
