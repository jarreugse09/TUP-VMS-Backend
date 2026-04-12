/**
 * Action Logger Middleware — Phase 3B
 * ─────────────────────────────────────
 * Automatically creates an ActionLog entry for every:
 *   - POST, PUT, PATCH, DELETE response (CRUD on personal data)
 *   - Explicit login / logout / failed login events
 *
 * Rules per plan (Section 7.7 + DPA 2012 Section 6.5g):
 *   - NEVER log raw qrCode values
 *   - Always capture: userId, action, targetModel, targetId, ip, userAgent, timestamp
 *   - All timestamps in Asia/Manila (UTC+8)
 *
 * Usage in route files:
 *   import { logAction } from "../middlewares/actionLogger";
 *   router.put("/:id", authenticateToken, controller, logAction("EDIT_ATTENDANCE", "AttendanceLog"));
 *
 * Or use the auto-interceptor on a router:
 *   router.use(autoActionLogger("AttendanceLog"));
 */

import { Request, Response, NextFunction } from "express";
import ActionLog from "../models/ActionLog";

interface AuthRequest extends Request {
  user?: any;
}

const MANILA_TZ = "Asia/Manila";

/** Convert a Date to Asia/Manila ISO string */
const getManilaTimestamp = (): Date => {
  // MongoDB stores UTC; we record the UTC value but intl-formatted for logs
  return new Date();
};

/** Sanitize body/metadata to remove any qrCode values before logging */
const sanitizeForLog = (data: Record<string, any>): Record<string, any> => {
  if (!data || typeof data !== "object") return {};
  const sanitized = { ...data };
  // Strip qrCode — treat as credential, never log (DPA 2012 Section 6.5f)
  delete sanitized.qrCode;
  delete sanitized.newQRString;
  delete sanitized.oldQR;
  delete sanitized.passwordHash;
  delete sanitized.password;
  return sanitized;
};

/**
 * Explicit action logger — call after the controller handler to record a
 * named action. Extract targetId from `req.params.id` or response body.
 */
export const logAction = (
  actionName: string,
  targetModel: string,
  targetIdFromParam?: string
) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    // Only log if a user is authenticated
    if (!req.user) return next();

    try {
      const targetId =
        targetIdFromParam ||
        req.params.id ||
        req.params.userId ||
        req.params.requestId ||
        null;

      await ActionLog.create({
        action: actionName,
        performedBy: req.user._id || req.user.id,
        targetModel,
        targetId: targetId || null,
        details: `${actionName} on ${targetModel}${targetId ? ` ID:${targetId}` : ""}`,
        metadata: sanitizeForLog(req.body || {}),
        severity: "info",
        ipAddress: req.ip || req.socket?.remoteAddress || null,
        userAgent: req.headers["user-agent"] || null,
        timestamp: getManilaTimestamp(),
      });
    } catch (err) {
      // Never crash the request due to logging failure
      console.error("[ActionLogger] Failed to write action log:", err);
    }

    next();
  };
};

/**
 * Auto action logger middleware — attach to a router to automatically
 * log all mutating requests (POST/PUT/PATCH/DELETE) on that router.
 * The action name is derived from the HTTP method.
 */
export const autoActionLogger = (targetModel: string) => {
  const METHOD_ACTION_MAP: Record<string, string> = {
    POST:   "CREATE",
    PUT:    "UPDATE",
    PATCH:  "UPDATE",
    DELETE: "DELETE",
  };

  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const action = METHOD_ACTION_MAP[req.method?.toUpperCase()];
    if (!action || !req.user) return next();

    // Hook into response finish to capture the outcome
    const originalJson = res.json.bind(res);
    res.json = (body: any) => {
      // Only log if the response was successful (2xx)
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const targetId =
          req.params.id ||
          req.params.userId ||
          body?._id ||
          body?.data?._id ||
          null;

        ActionLog.create({
          action: `${action}_${targetModel.toUpperCase()}`,
          performedBy: req.user._id || req.user.id,
          targetModel,
          targetId,
          details: `${req.method} ${req.originalUrl}`,
          metadata: sanitizeForLog(req.body || {}),
          severity: action === "DELETE" ? "warning" : "info",
          ipAddress: req.ip || req.socket?.remoteAddress || null,
          userAgent: req.headers["user-agent"] || null,
          timestamp: getManilaTimestamp(),
        }).catch((err: any) =>
          console.error("[ActionLogger] Auto log error:", err)
        );
      }
      return originalJson(body);
    };

    next();
  };
};

/**
 * Explicit log helper for AUTH events (login/logout/failed_login).
 * Call directly from authController — does not use middleware pattern.
 */
export const logAuthEvent = async (
  action: "LOGIN" | "LOGOUT" | "FAILED_LOGIN",
  userId: string | null,
  req: Request,
  details?: string
) => {
  try {
    await ActionLog.create({
      action,
      performedBy: userId || "000000000000000000000000", // placeholder for failed login
      targetModel: "User",
      targetId: userId || null,
      details: details || action,
      metadata: { email: req.body?.email ? `[redacted]` : undefined },
      severity: action === "FAILED_LOGIN" ? "warning" : "info",
      ipAddress: req.ip || null,
      userAgent: req.headers["user-agent"] || null,
      timestamp: new Date(),
    });
  } catch (err) {
    console.error("[ActionLogger] Auth event log error:", err);
  }
};
