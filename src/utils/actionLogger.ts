import { Request, Response, NextFunction } from "express";
import ActionLog from "../models/ActionLog";

export const logAction = async (
  req: any,
  action: string,
  targetModel: string,
  targetId: any,
  details: string
) => {
  try {
    const performedBy = req.user ? req.user.id || req.user._id : null;
    if (!performedBy) return;

    await ActionLog.create({
      action,
      performedBy,
      targetModel,
      targetId,
      details,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
  } catch (error) {
    console.error("Failed to log action:", error);
  }
};
