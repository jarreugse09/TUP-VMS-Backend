import Attendance from "../models/Attendance";
import { catchAsync } from "../utils/catchAsync";
import { AppError } from "../utils/AppError";
import { NextFunction, Request, Response } from "express";

interface AuthRequest extends Request {
  user?: any;
}

export const getAttendance = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { startDate, endDate, page = "1", limit = "200" } = req.query as any;

    let query: any = {};
    if (startDate && endDate) {
      const start = new Date(startDate as string);
      const end = new Date(endDate as string);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      query.date = { $gte: start, $lte: end };
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
        select: "firstName surname role photoURL",
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

    res.status(200).json({ attendance, page: pageNum, limit: limitNum });
  },
);

// Export attendance with password verification
export const exportAttendance = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { startDate, endDate, month, format } = req.body;
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
    const query: any = { date: { $gte: start, $lte: end } };
    if (req.user.role !== "TUP") {
      query.staffId = req.user.id;
    }

    const attends = await Attendance.find(query)
      .populate("staffId", "firstName surname role")
      .sort({ date: -1 });

    const rows = attends.map((a) => {
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
