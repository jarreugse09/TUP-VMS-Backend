import Attendance from "../models/Attendance";
import User from "../models/User";
import VisitLog from "../models/VisitLog";
import TransactionLog from "../models/TransactionLog";
import { catchAsync } from "../utils/catchAsync";
import { AppError } from "../utils/AppError";
import { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import ActionLog from "../models/ActionLog";
import { getManilaTime } from "../utils/dateUtils";

interface AuthRequest extends Request {
  user?: any;
}

type ScanAction =
  | "time_in"
  | "time_out"
  | "break_start"
  | "break_end"
  | "go_out"
  | "go_in"
  | "transaction_start"
  | "transaction_end";

export const handleScan = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { qrCode, action, platesNumber, approvedBy, transactionType, notes } = req.body as {
      qrCode: string;
      action: ScanAction;
      platesNumber?: string;
      approvedBy?: string;
      transactionType?: string;
      notes?: string;
    };

    if (!qrCode || !action) {
      return next(new AppError("qrCode and action are required", 400));
    }

    const targetUser = await User.findOne({ qrCode }).lean();
    if (!targetUser) {
      return next(new AppError("Invalid QR code: user not found", 404));
    }

    if (targetUser.status === "Inactive") {
      return next(new AppError("Target user account is inactive", 403));
    }

    const now = getManilaTime();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const scannedBy = req.user?.id ? new mongoose.Types.ObjectId(req.user.id) : null;

    if (action === "transaction_start" || action === "transaction_end") {
      const clientId = req.user.id;
      const staffId = targetUser._id;
      const validProviders = [
        "hr_head",
        "hr_staff",
        "non_academic",
        "department_head",
        "dean",
        "top_management",
      ];

      if (!validProviders.includes(targetUser.subRole?.toLowerCase() || "")) {
        return next(new AppError("This user is not authorized to act as a Service Provider", 403));
      }

      if (action === "transaction_start") {
        if (!transactionType) {
          return next(new AppError("transactionType is required", 400));
        }

        const transaction = new TransactionLog({
          clientId,
          staffId,
          transactionStart: now,
          transactionType,
          notes,
          scannedBy: req.user.role === "Staff" ? "security" : "self",
          collegeId: targetUser.collegeId,
          departmentId: targetUser.departmentId,
        });
        await transaction.save();

        return res.status(200).json({
          success: true,
          message: `Transaction started with ${targetUser.firstName} ${targetUser.surname}`,
          data: { transactionId: transaction._id, transactionStart: now },
        });
      }

      const transaction = await TransactionLog.findOne({
        clientId,
        staffId,
        transactionEnd: null,
      }).sort({ transactionStart: -1 });

      if (!transaction) {
        return next(new AppError("No ongoing transaction found with this provider", 404));
      }

      transaction.transactionEnd = now;
      if (notes) transaction.notes = notes;
      await transaction.save();

      return res.status(200).json({
        success: true,
        message: `Transaction completed with ${targetUser.firstName} ${targetUser.surname}`,
        data: { transactionId: transaction._id, transactionEnd: now },
      });
    }

    const user = targetUser;
    const collegeId = user.collegeId;
    const departmentId = user.departmentId;

    if (user.role === "TUP" || user.role === "Staff") {
      const existingAttendance = await Attendance.findOne({
        staffId: user._id,
        date: { $gte: today, $lt: tomorrow },
        deletedAt: null,
      });

      const attendance = existingAttendance || new Attendance({
        staffId: user._id,
        date: today,
        scannedBy,
        status: "present",
        collegeId,
        departmentId,
      });

      switch (action) {
        case "time_in":
          if (attendance.timeIn) return next(new AppError("Already timed in", 409));
          attendance.timeIn = now;
          attendance.scannedBy = scannedBy;
          if (platesNumber) attendance.platesNumber = platesNumber;
          break;
        case "time_out":
          if (!attendance.timeIn) return next(new AppError("Must time in first", 400));
          if (attendance.timeOut) return next(new AppError("Already timed out", 409));
          attendance.timeOut = now;
          attendance.totalHours = Math.round(
            ((attendance.timeOut.getTime() - attendance.timeIn.getTime()) / (1000 * 60 * 60)) * 100,
          ) / 100;
          break;
        case "go_out":
        case "break_start":
          if (user.subRole === "maintenance" && action === "go_out") {
            if (!approvedBy) return next(new AppError("Supervisor approval required.", 400));
            const supervisor = await User.findById(approvedBy);
            if (!supervisor || supervisor.subRole !== "security_head") {
              return next(new AppError("Approval must be from Security Head.", 401));
            }

            await ActionLog.create({
              action: "MAINTENANCE_EXIT",
              performedBy: supervisor._id,
              targetId: user._id,
              details: `Exit approved for ${user.firstName} ${user.surname}`,
              metadata: { action, notes },
              severity: "info",
              collegeId: supervisor.collegeId,
              departmentId: supervisor.departmentId,
            });
          }

          if (action === "break_start") {
            if (attendance.breakStart) return next(new AppError("Break already started", 409));
            attendance.breakStart = now;
          } else {
            if (!attendance.goOutEntries) attendance.goOutEntries = [];
            attendance.goOutEntries.push({
              goOutTime: now,
              goInTime: null,
              reason: notes || "Go out",
              approvedBy: approvedBy ? new mongoose.Types.ObjectId(approvedBy) : null,
            });
          }
          break;
        case "break_end":
          if (!attendance.breakStart) return next(new AppError("Break not started", 400));
          if (attendance.breakEnd) return next(new AppError("Break already ended", 409));
          attendance.breakEnd = now;
          break;
        case "go_in":
          if (user.subRole === "maintenance") {
            if (!approvedBy) return next(new AppError("Supervisor approval required.", 400));
            const supervisor = await User.findById(approvedBy);
            if (!supervisor || supervisor.subRole !== "security_head") {
              return next(new AppError("Approval must be from Security Head.", 401));
            }

            await ActionLog.create({
              action: "MAINTENANCE_RETURN",
              performedBy: supervisor._id,
              targetId: user._id,
              details: `Return approved for ${user.firstName} ${user.surname}`,
              metadata: { action, notes },
              severity: "info",
              collegeId: supervisor.collegeId,
              departmentId: supervisor.departmentId,
            });
          }

          if (!attendance.goOutEntries?.length) return next(new AppError("No go_out entry", 400));
          const lastEntry = attendance.goOutEntries[attendance.goOutEntries.length - 1];
          if (lastEntry.goInTime) return next(new AppError("Already returned", 409));
          lastEntry.goInTime = now;
          break;
        default:
          return next(new AppError("Invalid action for workforce", 400));
      }

      await attendance.save();

      return res.status(200).json({
        success: true,
        message: `Action ${action} recorded for ${user.firstName} ${user.surname}`,
        data: {
          userId: user._id,
          name: `${user.firstName} ${user.surname}`,
          action,
          attendance: {
            timeIn: attendance.timeIn,
            timeOut: attendance.timeOut,
            breakStart: attendance.breakStart,
            breakEnd: attendance.breakEnd,
            goOutEntries: attendance.goOutEntries?.length || 0,
          },
        },
      });
    }

    if (action === "time_in") {
      const visit = new VisitLog({
        visitorId: user._id,
        date: today,
        timeIn: now,
        timeOut: null,
        purpose: notes || "General Access",
        scannedBy,
        platesNumber,
        collegeId,
        departmentId,
      });
      await visit.save();
      return res.status(200).json({
        success: true,
        message: `Access granted for ${user.firstName} ${user.surname}`,
      });
    }

    if (action === "time_out") {
      const lastVisit = await VisitLog.findOne({
        visitorId: user._id,
        date: today,
        timeOut: null,
      }).sort({ timeIn: -1 });

      if (!lastVisit) {
        return next(new AppError("No active visit found to checkout.", 400));
      }

      lastVisit.timeOut = now;
      await lastVisit.save();
      return res.status(200).json({
        success: true,
        message: `Exit recorded for ${user.firstName} ${user.surname}`,
      });
    }

    return next(new AppError("Visitors/Students only support time_in and time_out.", 400));
  },
);

export const handleManualScan = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { qrCode, action, platesNumber, approvedBy, transactionType, notes } = req.body as {
      qrCode: string;
      action: ScanAction;
      platesNumber?: string;
      approvedBy?: string;
      transactionType?: string;
      notes?: string;
    };

    req.body = {
      qrCode,
      action,
      platesNumber,
      approvedBy,
      transactionType,
      notes,
    };

    return handleScan(req, res, next);
  },
);
