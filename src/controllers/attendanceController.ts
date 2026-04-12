import Attendance from "../models/Attendance";
import { catchAsync } from "../utils/catchAsync";
import { AppError } from "../utils/AppError";
import { NextFunction, Request, Response } from "express";
import { getScopedUserIds } from "../utils/orgRbac";
import { logAction } from "../utils/actionLogger";
import { getManilaStartOfDay } from "../utils/dateUtils";

interface AuthRequest extends Request {
  user?: any;
}

const ATTENDANCE_STATUSES = new Set([
  "present",
  "late",
  "absent",
  "wfh",
  "holiday",
  "exempt",
  "present (unscheduled)",
]);

export const getAttendance = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const rawQuery = req.query as Record<string, string | undefined>;
    const startDate = rawQuery.startDate ?? rawQuery.dateFrom;
    const endDate = rawQuery.endDate ?? rawQuery.dateTo;
    const dateFilter = rawQuery.date;
    const statusFilter = rawQuery.status;
    const page = rawQuery.page ?? "1";
    const limit = rawQuery.limit ?? "200";
    const scopedUserIds = await getScopedUserIds(req.user, {
      workforceOnly: true,
      includeSubordinates: true,
    });

    let query: any = { staffId: { $in: scopedUserIds }, deletedAt: null };
    if (startDate && endDate) {
      const start = new Date(startDate as string);
      const end = new Date(endDate as string);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      query.date = { $gte: start, $lte: end };
    }
    if (dateFilter === "today") {
      const start = getManilaStartOfDay();
      const end = new Date(start);
      end.setHours(23, 59, 59, 999);
      query.date = { $gte: start, $lte: end };
    }
    if (statusFilter === "present") {
      query.timeIn = { $ne: null };
      query.timeOut = null;
    }

    const pageNum = Math.max(parseInt(page as string, 10) || 1, 1);
    const limitNum = Math.min(
      Math.max(parseInt(limit as string, 10) || 200, 1),
      1000,
    );
    const skip = (pageNum - 1) * limitNum;

    const attendance = await Attendance.find(query)
      .populate({
        path: "staffId",
        select: "firstName surname role subRole college department photoURL",
        options: { lean: true },
      })
      .populate({
        path: "scannedBy",
        select: "firstName surname",
        options: { lean: true },
      })
      .sort({ date: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    const { maskName } = require("../utils/masking");
    const shouldMask = req.user.subRole !== "hr_head" && req.user.subRole !== "security_head";

    if (shouldMask) {
      for (const entry of attendance as any[]) {
        if (entry.staffId && entry.staffId._id?.toString() !== req.user.id.toString()) {
           entry.staffId.firstName = maskName(entry.staffId.firstName, entry.staffId.surname);
           entry.staffId.surname = "";
        }
      }
    }

    res.status(200).json({ attendance, data: attendance, page: pageNum, limit: limitNum });
  },
);

// Export attendance with password verification
export const exportAttendance = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { startDate, endDate, month, format, role } = req.body;
    const { password } = req.body;

    if (!password || !format)
      return next(new AppError("Password and format are required", 400));

    // verify password
    const user = await require("../models/User")
      .default.findById(req.user.id)
      .select("+passwordHash");
    if (!user) return next(new AppError("User not found", 404));

    const isMatch = await require("bcryptjs").compare(
      password,
      user.passwordHash,
    );
    if (!isMatch) return next(new AppError("Invalid password", 401));

    // date range
    let start: Date, end: Date;
    if (month) {
      const [year, mon] = month.split("-").map((v: string) => parseInt(v, 10));
      start = new Date(year, mon - 1, 1);
      end = new Date(year, mon, 0, 23, 59, 59, 999);
    } else if (startDate && endDate) {
      start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
    } else {
      return next(new AppError("Date range or month required", 400));
    }

    // Only TUP can export all; others only their own
    const scopedUserIds = await getScopedUserIds(req.user, {
      workforceOnly: true,
      includeSubordinates: true,
    });
    const query: any = { date: { $gte: start, $lte: end }, staffId: { $in: scopedUserIds }, deletedAt: null };
    if (req.user.role !== "TUP" && !req.user?.subRole) {
      query.staffId = req.user.id;
    }

    const attends = await Attendance.find(query)
      .populate("staffId", "firstName surname role")
      .sort({ date: -1 });

    // Filter by role if specified
    let rows = attends.map((a) => {
      const staff = a.staffId as any;
      return {
        Date: a.date.toISOString().split("T")[0],
        Name: `${staff.firstName} ${staff.surname}`,
        Role: staff.role,
        "Time In": a.timeIn ? a.timeIn.toISOString() : "",
        "Time Out": a.timeOut ? a.timeOut.toISOString() : "",
        Status: a.timeOut ? "Checked Out" : "In TUP",
      };
    });

    if (role) {
      rows = rows.filter((row) => row.Role === role);
    }

    const filenameBase = `attendance_${start.toISOString().split("T")[0]}_to_${end.toISOString().split("T")[0]}`;

    if (format === "csv") {
      const { Parser } = require("json2csv");
      const parser = new Parser({
        fields: ["Date", "Name", "Role", "Time In", "Time Out", "Status"],
      });
      const csv = parser.parse(rows);
      res.header("Content-Type", "text/csv");
      res.attachment(`${filenameBase}.csv`).send(csv);
      return;
    }

    if (format === "xlsx") {
      const ExcelJS = require("exceljs");
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Attendance");
      sheet.columns = [
        { header: "Date", key: "Date", width: 15 },
        { header: "Name", key: "Name", width: 25 },
        { header: "Role", key: "Role", width: 15 },
        { header: "Time In", key: "Time In", width: 20 },
        { header: "Time Out", key: "Time Out", width: 20 },
        { header: "Status", key: "Status", width: 15 },
      ];

      rows.forEach((r) => sheet.addRow(r));

      const buffer = await workbook.xlsx.writeBuffer();
      res.header(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.attachment(`${filenameBase}.xlsx`).send(buffer);
      return;
    }

    return next(new AppError("Unsupported format", 400));
  },
);

// ─── GET MY DTR (Personal Daily Time Record) ─────────────────────────────────
export const getMyDTR = catchAsync(async (req: AuthRequest, res: Response) => {
  const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };
  
  const query: any = { staffId: req.user.id, deletedAt: null };
  
  if (startDate && endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    query.date = { $gte: start, $lte: end };
  }

  const attendance = await Attendance.find(query)
    .sort({ date: 1 }) // Chronological order for DTR
    .lean();

  const formattedLogs = attendance.map((log: any) => ({
    date: log.date.toISOString().split('T')[0],
    timeIn: log.timeIn ? new Date(log.timeIn).toLocaleTimeString('en-US', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit' }) : '-',
    timeOut: log.timeOut ? new Date(log.timeOut).toLocaleTimeString('en-US', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit' }) : '-',
    totalHours: log.totalHours || 0,
    status: log.status
  }));

  res.status(200).json({
    success: true,
    data: formattedLogs
  });
});

// ─── UPDATE ATTENDANCE (edit overrides) ──────────────────────────────────────
export const updateAttendance = catchAsync(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const { timeIn, timeOut, breakStart, breakEnd, status, notes, platesNumber } = req.body;

  if (status !== undefined && !ATTENDANCE_STATUSES.has(status)) {
    return next(new AppError("Invalid attendance status", 400));
  }

  const updateData: Record<string, unknown> = {};
  if (timeIn !== undefined) updateData.timeIn = timeIn;
  if (timeOut !== undefined) updateData.timeOut = timeOut;
  if (breakStart !== undefined) updateData.breakStart = breakStart;
  if (breakEnd !== undefined) updateData.breakEnd = breakEnd;
  if (status !== undefined) updateData.status = status;
  if (notes !== undefined) updateData.notes = notes;
  if (platesNumber !== undefined) updateData.platesNumber = platesNumber;

  const attendance = await Attendance.findOneAndUpdate(
    { _id: req.params.id, deletedAt: null },
    { $set: updateData },
    { new: true, runValidators: true }
  );

  if (!attendance) return next(new AppError("Attendance record not found", 404));

  await logAction(req, "ATTENDANCE_UPDATED", "Attendance", req.params.id, "Attendance record updated manually");

  res.status(200).json({ attendance });
});

// ─── SOFT DELETE ATTENDANCE ──────────────────────────────────────────────────
export const softDeleteAttendance = catchAsync(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const attendance = await Attendance.findOneAndUpdate(
    { _id: req.params.id, deletedAt: null },
    { $set: { deletedAt: new Date() } }
  );

  if (!attendance) return next(new AppError("Attendance record not found", 404));

  await logAction(req, "ATTENDANCE_DELETED", "Attendance", req.params.id, "Attendance record soft-deleted");

  res.status(200).json({ deleted: true });
});
