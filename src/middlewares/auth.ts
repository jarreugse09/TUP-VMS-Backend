import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

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
    const userRole = String(req.user?.role || "")
      .trim()
      .toLowerCase();
    const allowedRoles = roles.map((role) => role.trim().toLowerCase());

    if (!req.user || !allowedRoles.includes(userRole)) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }
    next();
  };
};

export const isSecurityAccount = (user: any): boolean => {
  const userRole = String(user?.role || "").trim().toLowerCase();
  const userStaffType = String(user?.staffType || "").trim().toLowerCase();

  return userRole === "security" || (userRole === "staff" && userStaffType === "security");
};




export const authorizeRoleOrStaffType = (
  roles: string[] = [],
  staffTypes: string[] = []
) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const userRole = String(req.user?.role || "")
      .trim()
      .toLowerCase();
    const userStaffType = String(req.user?.staffType || "")
      .trim()
      .toLowerCase();

    const hasRole =
      roles.length > 0 &&
      roles.map((role) => role.trim().toLowerCase()).includes(userRole);

    const hasStaffType =
      staffTypes.length > 0 &&
      userStaffType &&
      staffTypes
        .map((staffType) => staffType.trim().toLowerCase())
        .includes(userStaffType);

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

  const userRole = String(req.user?.role || "").trim().toLowerCase();
  if (userRole === "tup" || isSecurityAccount(req.user)) {
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
