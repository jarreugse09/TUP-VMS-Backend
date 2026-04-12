import { handleScan, handleManualScan } from "../controllers/scanController";
import { authenticateToken, validateRbac } from "../middlewares/auth";
import { Request, Response, NextFunction } from "express";
import express from "express";

const router = express.Router();

// Transaction-only actions that all authenticated users can perform
const TRANSACTION_ACTIONS = new Set(["transaction_start", "transaction_end"]);

// Security + superadmin roles that get full scan access (attendance + visit + transaction)
const FULL_SCAN_ROLES = ["security_head", "security_staff"];

/**
 * Gate middleware: allow full access to security/superadmin,
 * restrict all other authenticated users to transaction actions only.
 */
const scanAccessGate = (req: any, res: Response, next: NextFunction) => {
  if (!req.user) return res.status(401).json({ message: "Unauthorized" });

  const subRole: string = req.user.subRole || "";
  const action: string = req.body?.action || "";

  // Superadmin and security roles get unrestricted scan access
  if (
    req.user.subRole === "superadmin" ||
    FULL_SCAN_ROLES.includes(subRole)
  ) {
    return next();
  }

  // All other authenticated users: transaction scan only
  if (!TRANSACTION_ACTIONS.has(action)) {
    return res.status(403).json({
      message: "Access denied: only security personnel can perform attendance or visit scans.",
    });
  }

  next();
};

// POST /api/scan — Unified scan endpoint
// All authenticated users can access; action-type gate enforces scope
router.post(
  "/",
  authenticateToken,
  scanAccessGate,
  handleScan
);

// POST /api/scan/manual — Manual QR code entry (security + superadmin only)
router.post(
  "/manual",
  authenticateToken,
  validateRbac([], ["superadmin", "security_head", "security_staff"]),
  handleManualScan
);

export default router;

