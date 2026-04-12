import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import {
  isAlertAudience,
  isTupSuperAdmin,
  matchesRoleToken,
} from "../utils/rbac";
import Attendance from "../models/Attendance";
import User from "../models/User";
import ActionLog from "../models/ActionLog";
import VisitLog from "../models/VisitLog";
import TransactionLog from "../models/TransactionLog";
import mongoose from "mongoose";
import type { JwtPayload } from "jsonwebtoken";

interface AuthRequest extends Request {
  user?: JwtPayload & {
    id?: string;
    _id?: string;
    role?: string;
    subRole?: string;
    firstName?: string;
    surname?: string;
    collegeId?: string;
    departmentId?: string;
  };
}

const createAuthAuditLog = async (
  req: Request,
  action: "AUTH_TOKEN_INVALID" | "LOGIN_BLOCKED",
  details: string,
  performedBy?: string | null,
) => {
  await ActionLog.create({
    performedBy: performedBy ?? null,
    action,
    targetModel: "User",
    targetId: performedBy ?? null,
    details,
    severity: "warning",
    ipAddress: req.ip,
    userAgent: req.get("User-Agent") ?? "",
  });
};

// ── Require Role or SubRole ──────────────────────────────────────────────────────
// Logic: pass if user's role is in `roles` OR user's subRole is in `subRoles`.
// Superadmin always bypasses role checks.
// Fail-closed: return 403 if neither matches and user is not superadmin.
export const validateRbac = (
  roles: string[] = [],
  subRoles: string[] = []
) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const authUser = req.user;

    // Superadmin bypass — unrestricted access to all routes
    if (authUser.subRole === "superadmin") {
      return next();
    }

    const hasRole = roles.length === 0 || roles.some((role) => matchesRoleToken(authUser, role));
    const hasSubRole =
      subRoles.length === 0 ||
      subRoles.some((subRole) =>
        authUser.subRole?.toLowerCase() === subRole.toLowerCase()
      );

    // Pass if EITHER condition matches (OR semantics)
    // When both arrays are non-empty, require at least one match from each
    if (roles.length > 0 && subRoles.length > 0) {
      // Strict mode: role AND subRole must match
      if (hasRole && hasSubRole) return next();
      return res.status(403).json({ message: "Insufficient permissions" });
    }

    if (!hasRole && !hasSubRole) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }

    next();
  };
};

// ── Require Scope Access (for data isolation) ────────────────────────────────────
export const requireScopeAccess = (scopeType: "college" | "department") => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const authUser = req.user;

    const targetId = req.params.id;
    const targetCollegeId = req.query.collegeId || req.body.collegeId;
    const targetDepartmentId = req.query.departmentId || req.body.departmentId;

    // HR and Security have full access
    const hrSecurityRoles = ["hr_head", "hr_staff", "security_head", "security_staff"];
    const subRole = authUser.subRole?.toLowerCase();
    
    if (subRole && hrSecurityRoles.includes(subRole)) {
      return next();
    }

    // Fail-Closed: If Dean/Dept Head is missing their own org ID, block everything
    if (subRole === "dean" && !authUser.collegeId) {
      return res.status(403).json({ message: "Forbidden: Missing College Assignment" });
    }
    if (subRole === "department_head" && !authUser.departmentId) {
      return res.status(403).json({ message: "Forbidden: Missing Department Assignment" });
    }

    // ── Single resource access check for scoped records ─────────────────────
    if (targetId && mongoose.Types.ObjectId.isValid(targetId)) {
      // Check the silo-aware resources that remain in the live architecture.
      const checkers = [
        () => VisitLog.findById(targetId).lean<Record<string, unknown> | null>(),
        () => Attendance.findById(targetId).lean<Record<string, unknown> | null>(),
        () => User.findById(targetId).lean<Record<string, unknown> | null>(),
        () => TransactionLog.findById(targetId).lean<Record<string, unknown> | null>(),
        () => ActionLog.findById(targetId).lean<Record<string, unknown> | null>(),
      ];
      let resource: Record<string, unknown> | null = null;

      for (const findResource of checkers) {
        resource = await findResource();
        if (resource) break;
      }

      if (resource) {
        const resourceCollegeId =
          resource.collegeId instanceof mongoose.Types.ObjectId
            ? resource.collegeId.toString()
            : typeof resource.collegeId === "string"
              ? resource.collegeId
              : undefined;
        const resourceDeptId =
          resource.departmentId instanceof mongoose.Types.ObjectId
            ? resource.departmentId.toString()
            : typeof resource.departmentId === "string"
              ? resource.departmentId
              : undefined;

        let forbidden = false;
        if (subRole === "dean") {
          if (resourceCollegeId && resourceCollegeId !== authUser.collegeId?.toString()) {
            forbidden = true;
          }
        } else if (subRole === "department_head") {
          if (resourceDeptId && resourceDeptId !== authUser.departmentId?.toString()) {
            forbidden = true;
          }
        }

        if (forbidden) {
          // Log Suspicious Access Attempt
          await ActionLog.create({
            action: "SUSPICIOUS_ACCESS_ATTEMPT",
            performedBy: authUser._id,
            details: `Cross-Silo Access Attempt on ${targetId} by ${authUser.firstName} ${authUser.surname}`,
            metadata: { 
              targetId, 
              viewerCollegeId: authUser.collegeId, 
              resourceCollegeId 
            },
            severity: "critical"
          });
          return res.status(403).json({ message: "Access denied: outside your scope." });
        }
      }
    }

    // ── Bulk/Filter Check (via query params) ──────────────────────────────
    if (subRole === "dean") {
      if (scopeType === "college") {
        if (targetCollegeId && targetCollegeId !== authUser.collegeId?.toString()) {
          return res.status(403).json({ message: "Access denied: outside your college" });
        }
      }
    }

    if (subRole === "department_head") {
      if (targetDepartmentId && targetDepartmentId !== authUser.departmentId?.toString()) {
        return res.status(403).json({ message: "Access denied: outside your department" });
      }
    }

    next();
  };
};

export const authenticateToken = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Access token required" });
  }

  jwt.verify(token, process.env.JWT_SECRET!, async (err, user) => {
    if (err) {
      await createAuthAuditLog(
        req,
        "AUTH_TOKEN_INVALID",
        `Invalid or expired token on ${req.method} ${req.path}`,
      );
      return res.status(403).json({ message: "Invalid token" });
    }

    const decodedUser = user as AuthRequest["user"];
    if (!decodedUser) {
      await createAuthAuditLog(
        req,
        "AUTH_TOKEN_INVALID",
        `Invalid or expired token on ${req.method} ${req.path}`,
      );
      return res.status(403).json({ message: "Invalid token" });
    }

    try {
      const userId = decodedUser.id || decodedUser._id;
      if (userId) {
        // Real-time status check for strict enforcement
        const dbUser = await User.findById(userId, 'status suspendedUntil');
        if (dbUser) {
          if (dbUser.status === "Blocked") {
            await createAuthAuditLog(
              req,
              "LOGIN_BLOCKED",
              `Blocked account attempted API access. Reason: ${dbUser.blockedReason ?? "Contact administrator."}`,
              String(dbUser._id),
            );
            return res.status(403).json({ error: "account_blocked", message: "Your account is permanently blocked." });
          }
          if (dbUser.status === "Suspended") {
            if (dbUser.suspendedUntil && new Date(dbUser.suspendedUntil) < new Date()) {
              // Auto-restore
              await User.findByIdAndUpdate(userId, {
                status: "Active",
                suspendedUntil: null,
                suspensionReason: null
              });
              // allow login
            } else {
              await createAuthAuditLog(
                req,
                "LOGIN_BLOCKED",
                `Suspended account attempted API access until ${dbUser.suspendedUntil ?? "unknown"}. Reason: ${dbUser.suspensionReason ?? "No reason given."}`,
                String(dbUser._id),
              );
              return res.status(403).json({ 
                error: "account_suspended", 
                until: dbUser.suspendedUntil,
                message: `Your account is suspended until ${dbUser.suspendedUntil}` 
              });
            }
          }
        }
      }
    } catch (e) {
      console.error("Auth DB check error:", e);
    }
    
    req.user = decodedUser;
    next();
  });
};

export const authorizeRoles = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.some((role) => matchesRoleToken(req.user, role))) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }
    next();
  };
};

export const authorizeRoleOrStaffType = (
  roles: string[] = [],
  staffTypes: string[] = []
) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const hasRole = roles.some((role) => matchesRoleToken(req.user, role));
    const hasStaffType = staffTypes.some((staffType) =>
      matchesRoleToken(req.user, staffType),
    );

    if (!hasRole && !hasStaffType) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }

    next();
  };
};

export const authorizeAlertAudience = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (isAlertAudience(req.user)) {
    next();
    return;
  }

  return res.status(403).json({ message: "Insufficient permissions" });
};

export const authorizeTupSuperAdmin = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (isTupSuperAdmin(req.user)) {
    next();
    return;
  }

  return res.status(403).json({ message: "Insufficient permissions" });
};

// ── API Key Authentication (for CCTV webhook) ─────────────────────────────────
export const authenticateApiKey = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const apiKey = req.headers["x-api-key"];
  const expectedApiKey = process.env.CCTV_API_KEY;

  if (!expectedApiKey) {
    console.error("[Auth] CCTV_API_KEY environment variable is not set");
    return res.status(500).json({ message: "Server configuration error" });
  }

  if (!apiKey || apiKey !== expectedApiKey) {
    return res.status(401).json({ message: "Invalid or missing API key" });
  }

  next();
};

export const authorizeChatAccess = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const allowedSubRoles = ["superadmin", "security_head", "security_staff", "top_management"];
  if (req.user.subRole && allowedSubRoles.includes(req.user.subRole.toLowerCase())) {
    return next();
  }

  return res.status(403).json({ message: "Insufficient permissions for chat access" });
};
