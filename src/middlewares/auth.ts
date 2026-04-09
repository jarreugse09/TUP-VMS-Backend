import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import {
  isAlertAudience,
  isTupSuperAdmin,
  matchesRoleToken,
} from "../utils/rbac";

interface AuthRequest extends Request {
  user?: any;
}

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

  jwt.verify(token, process.env.JWT_SECRET!, (err: any, user: any) => {
    if (err) {
      return res.status(403).json({ message: "Invalid token" });
    }
    req.user = user;
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
