import { Request, Response } from "express";
import ActionLog from "../models/ActionLog";
import { catchAsync } from "../utils/catchAsync";

interface AuthRequest extends Request {
  user?: any;
}

const normalizeActionLog = (entry: Record<string, any>) => ({
  ...entry,
  createdAt: entry.timestamp ?? null,
});

export const getMyActionLogs = catchAsync(async (req: AuthRequest, res: Response) => {
  const page = Math.max(parseInt((req.query.page as string) || "1", 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt((req.query.limit as string) || "20", 10) || 20, 1), 100);
  const skip = (page - 1) * limit;
  const { dateFrom, dateTo } = req.query as { dateFrom?: string; dateTo?: string };

  const query: Record<string, unknown> = {
    performedBy: req.user?._id || req.user?.id,
  };

  if (dateFrom || dateTo) {
    query.timestamp = {};
    if (dateFrom) {
      (query.timestamp as Record<string, Date>).$gte = new Date(dateFrom);
    }
    if (dateTo) {
      (query.timestamp as Record<string, Date>).$lte = new Date(dateTo);
    }
  }

  const [logs, total] = await Promise.all([
    ActionLog.find(query)
      .populate({ path: "performedBy", select: "firstName surname role subRole photoURL", options: { lean: true } })
      .populate({ path: "targetId", select: "firstName surname role subRole", options: { lean: true } })
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    ActionLog.countDocuments(query),
  ]);

  res.status(200).json({
    success: true,
    data: logs.map((entry) => normalizeActionLog(entry as Record<string, any>)),
    total,
    page,
    limit,
  });
});

export const getActionLogs = catchAsync(async (req: AuthRequest, res: Response) => {
  const { userId, action, severity, dateFrom, dateTo, page = "1", limit = "50" } = req.query as {
    userId?: string;
    action?: string;
    severity?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: string;
    limit?: string;
  };

  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const skip = (pageNum - 1) * limitNum;

  const query: Record<string, unknown> = {};
  if (userId) query.performedBy = userId;
  if (action) query.action = action;
  if (severity) query.severity = severity;
  if (dateFrom || dateTo) {
    query.timestamp = {};
    if (dateFrom) {
      (query.timestamp as Record<string, Date>).$gte = new Date(dateFrom);
    }
    if (dateTo) {
      (query.timestamp as Record<string, Date>).$lte = new Date(dateTo);
    }
  }

  const [logs, total] = await Promise.all([
    ActionLog.find(query)
      .populate({ path: "performedBy", select: "firstName surname role subRole photoURL", options: { lean: true } })
      .populate({ path: "targetId", select: "firstName surname role subRole", options: { lean: true } })
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
    ActionLog.countDocuments(query),
  ]);

  res.status(200).json({
    success: true,
    data: logs.map((entry) => normalizeActionLog(entry as Record<string, any>)),
    total,
    page: pageNum,
    limit: limitNum,
  });
});
