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
