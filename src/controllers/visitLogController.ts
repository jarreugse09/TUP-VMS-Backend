import { Request, Response } from "express";
import VisitLog from "../models/VisitLog";
import { catchAsync } from "../utils/catchAsync";

interface AuthRequest extends Request {
  user?: any;
}

const buildVisitQuery = (req: AuthRequest, ownOnly: boolean) => {
  const { dateFrom, dateTo } = req.query as { dateFrom?: string; dateTo?: string };
  const query: Record<string, unknown> = {};
  const subRole = req.user?.subRole?.toLowerCase?.() || "";
  const canSeeAll = [
    "superadmin",
    "security_head",
    "security_staff",
    "hr_head",
    "hr_staff",
  ].includes(subRole);

  if (ownOnly || !canSeeAll) {
    query.visitorId = req.user?._id || req.user?.id;
  }

  if (dateFrom || dateTo) {
    query.date = {};
    if (dateFrom) {
      (query.date as Record<string, Date>).$gte = new Date(dateFrom);
    }
    if (dateTo) {
      (query.date as Record<string, Date>).$lte = new Date(dateTo);
    }
  }

  return query;
};

const fetchVisitLogs = async (query: Record<string, unknown>) =>
  VisitLog.find(query)
    .populate({ path: "visitorId", select: "firstName surname role photoURL", options: { lean: true } })
    .populate({ path: "hostId", select: "firstName surname role department college", options: { lean: true } })
    .populate({ path: "scannedBy", select: "firstName surname", options: { lean: true } })
    .sort({ date: -1, timeIn: -1 })
    .lean();

export const getVisitLogs = catchAsync(async (req: AuthRequest, res: Response) => {
  const visits = await fetchVisitLogs(buildVisitQuery(req, false));
  res.status(200).json({ data: visits });
});

export const getMyVisitLogs = catchAsync(async (req: AuthRequest, res: Response) => {
  const visits = await fetchVisitLogs(buildVisitQuery(req, true));
  res.status(200).json({ data: visits });
});
