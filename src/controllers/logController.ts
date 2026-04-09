import { Request, Response, type NextFunction } from "express";
import Log from "../models/Log";
import Activity from "../models/Activity";
import User from "../models/User";
import QRCode from "../models/QRCode";
import Attendance from "../models/Attendance";
import { catchAsync } from "../utils/catchAsync";
import { AppError } from "../utils/AppError";
import { getScopedUserIds } from "../utils/orgRbac";

interface AuthRequest extends Request {
  user?: any;
}

// ─── ADMIN / SECURITY SCAN ────────────────────────────────────────────────────
export const scanQR = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { qrString, mode, reason, approvedBy } = req.body;

    if (!qrString || !mode || !reason) {
      return next(new AppError("Invalid empty field/s", 400));
    }

    const qrCode = await QRCode.findOne({ qrString });
    if (!qrCode) return next(new AppError("QR code not found", 404));

    const user = await User.findById(qrCode.userId);
    if (!user) return next(new AppError("User not found", 404));

    const safeUser = {
      _id: user._id,
      firstName: user.firstName,
      surname: user.surname,
      role: user.role,
      photoURL: user.photoURL,
      status: user.status,
      staffType: user.staffType,
    };

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // ── STUDENT / VISITOR ─────────────────────────────────────────────────
    if (user.role === "Student" || user.role === "Visitor") {
      if (mode === "checkin") {
        const existingLog = await Log.findOne({
          userId: user._id,
          date: { $gte: today },
          timeOut: null,
          status: "In TUP",
        });
        if (existingLog) return next(new AppError("User already check in", 400));

        const log = new Log({
          userId: user._id,
          qrId: qrCode._id,
          date: new Date(),
          timeIn: new Date(),
          status: "In TUP",
          reason: "checkin", // ← changed from "transaction" to avoid collision with visit scans
          scannedBy: req.user.id,
        });
        const savedLog = await log.save();
        if (!savedLog) return next(new AppError("Failed to check in. Please try again.", 400));

        return res.status(201).json({ message: "Checked In Successfully", user: safeUser });
      }

      else if (mode === "checkout") {
        const existingLog = await Log.findOne({
          userId: user._id,
          date: { $gte: today },
          timeOut: null,
          status: { $ne: "Checked Out" },
        });
        if (!existingLog) return next(new AppError("User must check in first!", 400));

        const updateResult = await Log.updateOne(
          { _id: existingLog._id },
          { $set: { timeOut: new Date(), status: "Checked Out" } }
        );
        if (updateResult.modifiedCount === 0) {
          return next(new AppError("Failed to checkout. Please try again.", 400));
        }

        return res.status(201).json({ message: "Checked Out Successfully", user: safeUser });
      }
    }

    // ── STAFF / TUP ───────────────────────────────────────────────────────
    else if (user.role === "Staff" || user.role === "TUP") {
      if (mode === "checkin") {
        if (reason === "attendance") {
          const attend = await Attendance.findOne({
            staffId: user._id,
            date: { $gte: today },
            timeOut: null,
          });
          if (attend) return next(new AppError("User already attended.", 400));

          const newAttend = await Attendance.create({
            staffId: user._id,
            date: new Date(),
            timeIn: new Date(),
            scannedBy: req.user.id,
          });
          if (!newAttend) return next(new AppError("Attendance creation failed.", 404));

          const newLog = await Log.create({
            userId: user._id,
            qrId: qrCode._id,
            date: new Date(),
            timeIn: new Date(),
            status: "In TUP",
            reason: "attendance",
            scannedBy: req.user.id,
          });
          if (!newLog) return next(new AppError("Saving Log failed.", 404));

          return res.status(200).json({
            message: "Attendance check-in successful",
            attendance: newAttend,
            log: newLog,
            user: safeUser,
          });
        }

        else if (reason === "go out") {
          const existingLog = await Log.findOne({
            userId: user._id,
            status: "Checked Out",
            reason: "go out",
            timeOut: { $gte: today },
          });

          if (existingLog) {
            existingLog.timeIn = new Date();
            existingLog.status = "In TUP";
            await existingLog.save();
            return res.status(200).json({ message: "Check-in successful", log: existingLog, user: safeUser });
          } else {
            const newLog = await Log.create({
              userId: user._id,
              qrId: qrCode._id,
              date: new Date(),
              timeIn: new Date(),
              timeOut: null,
              reason,
              status: "In TUP",
              scannedBy: req.user.id,
            });
            if (!newLog) return next(new AppError("New Log creation failed.", 400));
          }
        }

        else if (reason === "break") {
          const existingLog = await Log.findOne({
            userId: user._id,
            status: "Checked Out",
            reason: "break",
            timeOut: { $gte: today },
          });

          if (existingLog) {
            existingLog.timeIn = new Date();
            existingLog.status = "In TUP";
            await existingLog.save();
            return res.status(200).json({ message: "Break return successful", log: existingLog });
          } else {
            const newLog = await Log.create({
              userId: user._id,
              qrId: qrCode._id,
              date: new Date(),
              timeIn: new Date(),
              timeOut: null,
              reason: "break",
              status: "In TUP",
              scannedBy: req.user.id,
            });
            return res.status(201).json({ message: "Break check-in successful", log: newLog, user: safeUser });
          }
        }

        else {
          return next(new AppError("Invalid reason", 500));
        }
      }

      else if (mode === "checkout") {
        if (reason === "attendance") {
          const log = await Log.findOne({
            userId: user._id,
            date: { $gte: today },
            status: "In TUP",
            reason: "attendance",
            timeOut: null,
          });
          if (!log) return next(new AppError("No active check-in found", 400));

          log.timeOut = new Date();
          log.status = "Checked Out";
          await log.save();

          const existingAttendance = await Attendance.findOne({
            staffId: user._id,
            date: { $gte: today },
            timeOut: null,
          });
          if (!existingAttendance) return next(new AppError("No active check-in", 400));

          existingAttendance.timeOut = new Date();
          await existingAttendance.save();

          return res.status(201).json({ status: "success", message: "Check out successful.", user: safeUser });
        }

        else if (reason === "break") {
          const newLog = await Log.create({
            userId: user._id,
            qrId: qrCode._id,
            date: new Date(),
            timeOut: new Date(),
            timeIn: null,
            status: "Checked Out",
            reason: "break",
            scannedBy: req.user.id,
          });
          if (!newLog) return next(new AppError("Saving log failed.", 404));
          return res.status(201).json({ status: "success", message: "Check out successful.", user: safeUser });
        }

        else if (reason === "go out") {
          if (user.role === "Staff" && user.staffType === "Maintenance") {
            if (!approvedBy) return next(new AppError("Please provide the person who approved to go out.", 404));

            const newLog = await Log.create({
              userId: user._id,
              qrId: qrCode._id,
              date: new Date(),
              timeOut: new Date(),
              status: "Checked Out",
              reason: "go out",
              scannedBy: req.user.id,
              approvedBy,
            });
            if (!newLog) return next(new AppError("Saving log failed.", 404));
            return res.status(201).json({ status: "success", message: "Check out successful." });
          } else {
            const newLog = await Log.create({
              userId: user._id,
              qrId: qrCode._id,
              date: new Date(),
              timeOut: new Date(),
              status: "Checked Out",
              reason: "go out",
              scannedBy: req.user.id,
            });
            if (!newLog) return next(new AppError("Saving log failed.", 404));
            return res.status(201).json({ status: "success", message: "Check out successful." });
          }
        }

        else {
          return next(new AppError("Invalid reason", 500));
        }
      }
    }
  },
);

// ─── STAFF ↔ STAFF TRANSACTION SCAN ──────────────────────────────────────────
export const scanTransactionQR = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { qrString, mode, type } = req.body;

    if (!qrString || !mode || type !== "Transaction") {
      return next(new AppError("Invalid empty fields.", 400));
    }

    const qrCode = await QRCode.findOne({ qrString });
    if (!qrCode) return next(new AppError("QR code not found", 404));

    const user = await User.findById(qrCode.userId);
    if (!user) return next(new AppError("User not found", 404));

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (req.user?.role !== "Staff") return next(new AppError("Invalid access", 500));

    if (mode === "checkin" && type === "Transaction") {
      const existingLog = await Log.findOne({
        userId: req.user.id,
        transId: user._id,
        qrId: qrCode._id,
        status: "Transaction",
        reason: type,
        date: { $gte: today },
        scannedBy: req.user.id,
        timeIn: null,
      });
      if (existingLog) {
        existingLog.timeIn = new Date();
        await existingLog.save();
      }

      const newLog = await Log.create({
        userId: req.user.id,
        transId: user._id,
        qrId: qrCode._id,
        status: type,
        reason: type,
        scannedBy: req.user.id,
        timeOut: null,
        date: today,
        timeIn: new Date(),
      });
      if (!newLog) return next(new AppError("Error Transaction. Please try again", 404));

      return res.status(201).json({ status: "success", message: "Transaction check-in." });
    }

    else if (mode === "checkout" && type === "Transaction") {
      const existingLog = await Log.findOne({
        userId: req.user.id,
        transId: user._id,
        qrId: qrCode._id,
        status: "Transaction",
        reason: type,
        date: { $gte: today },
        scannedBy: req.user.id,
        timeOut: null,
      });
      if (existingLog) {
        existingLog.timeOut = new Date();
        await existingLog.save();
      }

      const newLog = await Log.create({
        userId: req.user.id,
        transId: user._id,
        qrId: qrCode._id,
        status: type,
        reason: type,
        scannedBy: req.user.id,
        timeIn: null,
        date: today,
        timeOut: new Date(),
      });
      if (!newLog) return next(new AppError("Error Transaction. Please try again", 404));

      return res.status(201).json({ status: "success", message: "Transaction check-out." });
    }
  },
);

// ─── VISITOR / STUDENT → STAFF TRANSACTION SCAN ──────────────────────────────
export const visitorScanQR = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { qrString, type } = req.body;

    if (!qrString || type !== "Transaction") {
      return next(new AppError("Invalid empty fields.", 400));
    }

    const qrCode = await QRCode.findOne({ qrString });
    if (!qrCode) return next(new AppError("QR code not found", 404));

    const targetUser = await User.findOne({ _id: qrCode.userId });
    if (!targetUser) return next(new AppError("User not found", 404));

    if (
      req.user?.role !== "Visitor" &&
      req.user?.role !== "Student" &&
      req.user?.role !== "Staff"
    ) {
      return next(new AppError("Invalid access", 500));
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const newLog = await Log.create({
      userId:    req.user.id,       // who scanned
      transId:   targetUser._id,    // who was scanned — transId presence marks this as a visit transaction
      qrId:      qrCode._id,
      status:    "Transaction",
      reason:    "transaction",
      scannedBy: req.user.id,
      date:      today,
      timeIn:    new Date(),
    });
    if (!newLog) return next(new AppError("Error recording transaction. Please try again", 404));

    return res.status(201).json({
      status: "success",
      message: "Transaction recorded successfully",
      user: {
        _id:       targetUser._id,
        firstName: targetUser.firstName,
        surname:   targetUser.surname,
        role:      targetUser.role,
        photoURL:  targetUser.photoURL,
        status:    targetUser.status,
      },
    });
  }
);

// ─── RECORD ACTIVITY ──────────────────────────────────────────────────────────
export const recordActivity = async (req: AuthRequest, res: Response) => {
  try {
    const { toQR, activityType } = req.body;

    const toQRCode = await QRCode.findOne({ qrString: toQR });
    if (!toQRCode) return res.status(404).json({ message: "Target QR not found" });

    const toUser = await User.findById(toQRCode.userId);
    if (!toUser) return res.status(404).json({ message: "Target user not found" });

    const fromQRCode = await QRCode.findOne({ userId: req.user.id });

    const activity = new Activity({
      fromUserId: req.user.id,
      toUserId:   toUser._id,
      fromQR:     fromQRCode?.qrString || "",
      toQR,
      activityType,
    });
    await activity.save();

    res.json({ message: "Activity recorded" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

// ─── GET ALL LOGS (Admin) ─────────────────────────────────────────────────────
export const getLogs = catchAsync(async (req: AuthRequest, res: Response) => {
  const scopedUserIds = await getScopedUserIds(req.user, {
    includeSubordinates: true,
  });

  const logs = await Log.find({ userId: { $in: scopedUserIds } })
    .populate({ path: "userId", select: "firstName surname role subRole college department photoURL birthdate", options: { lean: true } })
    .sort({ date: -1, timeIn: -1 })
    .lean();

  const grouped: Record<string, any> = {};

  for (const log of logs) {
    const dateKey = log.date.toISOString().split("T")[0];
    const user    = log.userId as any;
    if (!user || !user._id) { console.warn("Skipping log with missing user reference", log._id); continue; }

    const key          = `${user._id}-${dateKey}`;
    const logTimestamp = log.timeOut ?? log.timeIn ?? log.date;

    if (!grouped[key]) {
      grouped[key] = { _id: key, date: log.date, user: log.userId, dailyStatus: log.status, _latestTime: logTimestamp, attendance: null, activities: [] };
    }

    if (log.reason === "attendance") {
      grouped[key].attendance = { timeIn: log.timeIn, timeOut: log.timeOut, status: log.status };
    } else if (log.reason) {
      grouped[key].activities.push({ reason: log.reason, timeIn: log.timeIn, timeOut: log.timeOut, status: log.status });
    }

    if (logTimestamp > grouped[key]._latestTime) {
      grouped[key].dailyStatus = log.status;
      grouped[key]._latestTime = logTimestamp;
    }
  }

  const result = Object.values(grouped).map(({ _latestTime, ...rest }) => rest);

  const userIds = Array.from(new Set(result.filter((e: any) => e.user?._id).map((e: any) => e.user._id.toString())));
  const qrCodes = userIds.length ? await QRCode.find({ userId: { $in: userIds } }).select("userId qrString").lean() : [];
  const qrMap   = new Map(qrCodes.map((qr: any) => [qr.userId.toString(), qr.qrString]));
  for (const entry of result) {
    if (entry.user?._id) entry.user = { ...entry.user, qrString: qrMap.get(entry.user._id.toString()) || null };
  }

  const staffIds = Array.from(
    new Set(
      result
        .filter((e: any) => e.user?.role === "Staff" || e.user?.role === "TUP")
        .map((e: any) => e.user._id.toString()),
    ),
  );
  if (staffIds.length) {
    const minDate = new Date(Math.min(...result.map((e: any) => new Date(e.date).getTime()))); minDate.setHours(0,0,0,0);
    const maxDate = new Date(Math.max(...result.map((e: any) => new Date(e.date).getTime()))); maxDate.setHours(23,59,59,999);
    const attends = await Attendance.find({ staffId: { $in: staffIds }, date: { $gte: minDate, $lte: maxDate } }).lean();
    const attMap  = new Map<string, any>();
    for (const a of attends) attMap.set(`${(a.staffId as any).toString()}-${new Date(a.date).toISOString().split("T")[0]}`, a);
    for (const entry of result) {
      if (!entry.attendance && entry.user?.role === "Staff") {
        const a = attMap.get(`${entry.user._id.toString()}-${new Date(entry.date).toISOString().split("T")[0]}`);
        if (a) entry.attendance = { timeIn: a.timeIn, timeOut: a.timeOut, status: a.timeOut ? "Checked Out" : "In TUP" };
      }
    }
  }

  res.json(result);
});

// ─── GET STAFF LOGS ───────────────────────────────────────────────────────────
export const getStaffLogs = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const logs = await Log.find({ userId: req.user.id })
      .populate({ path: "userId",  select: "firstName surname role photoURL birthdate", options: { lean: true } })
      .populate({ path: "transId", select: "firstName surname role",                   options: { lean: true } })
      .populate({ path: "qrId",    select: "qrString userId",                          options: { lean: true } })
      .sort({ date: -1, timeIn: -1 })
      .lean();

    const grouped: Record<string, any> = {};

    for (const log of logs) {
      const dateKey = log.date.toISOString().split("T")[0];
      const user    = log.userId as any;
      if (!user || !user._id) { console.warn("Skipping log with missing user reference", log._id); continue; }

      const key          = `${user._id}-${dateKey}`;
      const logTimestamp = log.timeOut ?? log.timeIn ?? log.date;

      if (!grouped[key]) {
        grouped[key] = { _id: key, date: log.date, user: log.userId, dailyStatus: log.status, _latestTime: logTimestamp, attendance: null, activities: [] };
      }

      if (log.reason === "attendance") {
        grouped[key].attendance = { timeIn: log.timeIn, timeOut: log.timeOut, status: log.status };
      } else if (log.reason) {
        const scannedPerson = log.transId as any;
        const scannedQR     = log.qrId    as any;
        grouped[key].activities.push({
          reason:         log.reason,
          timeIn:         log.timeIn,
          timeOut:        log.timeOut,
          status:         log.status,
          scannedQrString: scannedQR?.qrString || null,
          scannedTarget:  scannedPerson ? { firstName: scannedPerson.firstName, surname: scannedPerson.surname, role: scannedPerson.role } : null,
          scannedAt:      log.timeIn || log.timeOut || log.date,
        });
      }

      if (logTimestamp > grouped[key]._latestTime) {
        grouped[key].dailyStatus = log.status;
        grouped[key]._latestTime = logTimestamp;
      }
    }

    const result = Object.values(grouped).map(({ _latestTime, ...rest }) => rest);

    const userIds = Array.from(new Set(result.filter((e: any) => e.user?._id).map((e: any) => e.user._id.toString())));
    const qrCodes = userIds.length ? await QRCode.find({ userId: { $in: userIds } }).select("userId qrString").lean() : [];
    const qrMap   = new Map(qrCodes.map((qr: any) => [qr.userId.toString(), qr.qrString]));
    for (const entry of result) {
      if (entry.user?._id) entry.user = { ...entry.user, qrString: qrMap.get(entry.user._id.toString()) || null };
    }

    if (!result.length) return res.json([]);

    const minDate = new Date(Math.min(...result.map((e: any) => new Date(e.date).getTime()))); minDate.setHours(0,0,0,0);
    const maxDate = new Date(Math.max(...result.map((e: any) => new Date(e.date).getTime()))); maxDate.setHours(23,59,59,999);
    const attends = await Attendance.find({ staffId: req.user.id, date: { $gte: minDate, $lte: maxDate } }).lean();
    const attMap  = new Map<string, any>();
    for (const a of attends) attMap.set(`${(a.staffId as any).toString()}-${new Date(a.date).toISOString().split("T")[0]}`, a);
    for (const entry of result) {
      if (!entry.attendance && entry.user?.role === "Staff") {
        const a = attMap.get(`${entry.user._id.toString()}-${new Date(entry.date).toISOString().split("T")[0]}`);
        if (a) entry.attendance = { timeIn: a.timeIn, timeOut: a.timeOut, status: a.timeOut ? "Checked Out" : "In TUP" };
      }
    }

    res.json(result);
  },
);

// ─── GET USER TRANSACTIONS (flat list, outgoing only — legacy) ────────────────
export const getUserTransactions = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const transactionLogs = await Log.find({
      userId: req.user.id,
      transId: { $exists: true }, // only real visit transactions
    })
      .populate({ path: "transId", select: "firstName surname role", options: { lean: true } })
      .populate({ path: "qrId",    select: "qrString",               options: { lean: true } })
      .sort({ date: -1, timeIn: -1 })
      .lean();

    const result = transactionLogs.map((log: any) => ({
      _id:             log._id,
      date:            log.date,
      timeIn:          log.timeIn,
      timeOut:         log.timeOut,
      status:          log.status,
      reason:          log.reason,
      scannedTarget:   log.transId ? { firstName: log.transId.firstName, surname: log.transId.surname, role: log.transId.role } : null,
      scannedQRString: log.qrId?.qrString || null,
      scannedAt:       log.timeIn || log.timeOut || log.date,
    }));

    res.json(result);
  },
);

// ─── GET USER ATTENDANCE (Staff Attendance model records) ─────────────────────
export const getUserAttendance = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const attendanceRecords = await Attendance.find({ staffId: req.user.id }).sort({ date: -1 }).lean();
    const result = attendanceRecords.map((record: any) => ({
      _id:       record._id,
      date:      record.date,
      timeIn:    record.timeIn,
      timeOut:   record.timeOut,
      status:    record.timeOut ? "Checked Out" : "In TUP",
      scannedBy: record.scannedBy,
    }));
    res.json(result);
  },
);

// ─── GET ACTIVITIES ───────────────────────────────────────────────────────────
export const getActivities = async (req: AuthRequest, res: Response) => {
  try {
    const activities = await Activity.find({ fromUserId: req.user.id })
      .populate("toUserId", "firstName surname role")
      .sort({ timestamp: -1 });
    res.json(activities);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

// ─── EXPORT LOGS ──────────────────────────────────────────────────────────────
export const exportLogs = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { startDate, endDate, month, format, password } = req.body;

    if (!password || !format) return next(new AppError("Password and format are required", 400));

    const user = await User.findById(req.user.id).select("+passwordHash");
    if (!user) return next(new AppError("User not found", 404));

    const isMatch = await require("bcryptjs").compare(password, user.passwordHash);
    if (!isMatch) return next(new AppError("Invalid password", 401));

    let start: Date, end: Date;
    if (month) {
      const [year, mon] = month.split("-").map((v: string) => parseInt(v, 10));
      start = new Date(year, mon - 1, 1);
      end   = new Date(year, mon, 0, 23, 59, 59, 999);
    } else if (startDate && endDate) {
      start = new Date(startDate); start.setHours(0,0,0,0);
      end   = new Date(endDate);   end.setHours(23,59,59,999);
    } else {
      return next(new AppError("Date range or month required", 400));
    }

    const scopedUserIds = await getScopedUserIds(req.user, {
      workforceOnly: true,
      includeSubordinates: true,
    });
    let query: any = {
      date: { $gte: start, $lte: end },
      reason: "attendance",
      userId: { $in: scopedUserIds },
    };
    if (
      req.user.role !== "TUP" &&
      !req.user?.subRole
    ) query.userId = req.user.id;

    const logs = await Log.find(query).populate("userId", "firstName surname role").sort({ date: -1 });

    const grouped: Record<string, any> = {};
    for (const log of logs) {
      const dateKey      = log.date.toISOString().split("T")[0];
      const user         = log.userId as any;
      if (!user || !user._id) continue;
      const key          = `${user._id}-${dateKey}`;
      const logTimestamp = log.timeOut ?? log.timeIn ?? log.date;
      if (!grouped[key]) {
        grouped[key] = { date: dateKey, name: `${user.firstName} ${user.surname}`, role: user.role, timeIn: null, timeOut: null, status: log.status, _latestTime: logTimestamp };
      }
      if (log.reason === "attendance") {
        if (log.timeIn)  grouped[key].timeIn  = log.timeIn;
        if (log.timeOut) grouped[key].timeOut = log.timeOut;
      }
      if (logTimestamp > grouped[key]._latestTime) { grouped[key].status = log.status; grouped[key]._latestTime = logTimestamp; }
    }

    const rows = Object.values(grouped).map((r: any) => ({
      Date: r.date, Name: r.name, Role: r.role,
      "Time In":  r.timeIn  ? r.timeIn.toISOString()  : "",
      "Time Out": r.timeOut ? r.timeOut.toISOString() : "",
      Status: r.status,
    }));

    const filenameBase = `logs_${start.toISOString().split("T")[0]}_to_${end.toISOString().split("T")[0]}`;

    if (format === "csv") {
      const { Parser } = require("json2csv");
      const csv = new Parser({ fields: ["Date","Name","Role","Time In","Time Out","Status"] }).parse(rows);
      res.header("Content-Type", "text/csv");
      res.attachment(`${filenameBase}.csv`).send(csv);
      return;
    }
    if (format === "xlsx") {
      const ExcelJS  = require("exceljs");
      const workbook = new ExcelJS.Workbook();
      const sheet    = workbook.addWorksheet("Logs");
      sheet.columns = [
        { header: "Date",     key: "Date",     width: 15 },
        { header: "Name",     key: "Name",     width: 25 },
        { header: "Role",     key: "Role",     width: 15 },
        { header: "Time In",  key: "Time In",  width: 20 },
        { header: "Time Out", key: "Time Out", width: 20 },
        { header: "Status",   key: "Status",   width: 15 },
      ];
      rows.forEach((r) => sheet.addRow(r));
      const buffer = await workbook.xlsx.writeBuffer();
      res.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.attachment(`${filenameBase}.xlsx`).send(buffer);
      return;
    }

    return next(new AppError("Unsupported format", 400));
  },
);

// ─── GET MY LOGS (legacy grouped — kept for backward compat) ──────────────────
export const getMyLogs = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const allowedRoles = ["Student", "Visitor", "Staff"];
    if (!allowedRoles.includes(req.user?.role)) return next(new AppError("Access denied.", 403));

    const logs = await Log.find({ userId: req.user.id })
      .populate({ path: "userId",  select: "firstName surname role photoURL birthdate", options: { lean: true } })
      .populate({ path: "transId", select: "firstName surname role",                   options: { lean: true } })
      .populate({ path: "qrId",    select: "qrString userId",                          options: { lean: true } })
      .sort({ date: -1, timeIn: -1 })
      .lean();

    const grouped: Record<string, any> = {};

    for (const log of logs) {
      const dateKey      = log.date.toISOString().split("T")[0];
      const user         = log.userId as any;
      if (!user || !user._id) continue;

      const key          = `${user._id}-${dateKey}`;
      const logTimestamp = log.timeOut ?? log.timeIn ?? log.date;

      if (!grouped[key]) {
        grouped[key] = { _id: key, date: log.date, user: log.userId, dailyStatus: log.status, _latestTime: logTimestamp, attendance: null, activities: [] };
      }

      if (log.reason === "attendance") {
        grouped[key].attendance = { timeIn: log.timeIn, timeOut: log.timeOut, status: log.status };
      } else if (log.transId) {
        // Has transId = real visit transaction
        const scannedPerson = log.transId as any;
        const scannedQR     = log.qrId    as any;
        grouped[key].activities.push({
          reason: "transaction",
          wentTo: scannedPerson ? { firstName: scannedPerson.firstName, surname: scannedPerson.surname, role: scannedPerson.role } : null,
          scannedQrString: scannedQR?.qrString || null,
          timeIn:   log.timeIn  || null,
          timeOut:  log.timeOut || null,
          status:   log.status,
          scannedAt: log.timeIn || log.timeOut || log.date,
        });
      } else if (log.reason) {
        grouped[key].activities.push({
          reason: log.reason, wentTo: null,
          timeIn: log.timeIn || null, timeOut: log.timeOut || null,
          status: log.status, scannedAt: log.timeIn || log.timeOut || log.date,
        });
      }

      if (logTimestamp > grouped[key]._latestTime) { grouped[key].dailyStatus = log.status; grouped[key]._latestTime = logTimestamp; }
    }

    const result  = Object.values(grouped).map(({ _latestTime, ...rest }) => rest);
    const userIds = Array.from(new Set(result.filter((e: any) => e.user?._id).map((e: any) => e.user._id.toString())));
    const qrCodes = userIds.length ? await QRCode.find({ userId: { $in: userIds } }).select("userId qrString").lean() : [];
    const qrMap   = new Map(qrCodes.map((qr: any) => [qr.userId.toString(), qr.qrString]));
    for (const entry of result) {
      if (entry.user?._id) entry.user = { ...entry.user, qrString: qrMap.get(entry.user._id.toString()) || null };
    }

    return res.json(result);
  },
);

// ─── GET MY ATTENDANCE (check-in/out only, no visit transactions) ─────────────
export const getMyAttendance = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const allowedRoles = ["Student", "Visitor", "Staff", "Security"];
    if (!allowedRoles.includes(req.user?.role)) return next(new AppError("Access denied.", 403));

    // KEY FIX: transId absence = check-in/out log, transId presence = visit transaction
    // Student/Visitor check-ins use reason:"checkin" (updated in scanQR above)
    // Staff check-ins use reason:"attendance", "break", "go out"
    // Visit scans always have transId set
    const logs = await Log.find({
      userId:  req.user.id,
      transId: { $exists: false }, // no transId → attendance-related, not a visit scan
    })
      .populate({ path: "userId", select: "firstName surname role photoURL birthdate", options: { lean: true } })
      .sort({ date: -1, timeIn: -1 })
      .lean();

    const grouped: Record<string, any> = {};

    for (const log of logs) {
      const dateKey      = log.date.toISOString().split("T")[0];
      const user         = log.userId as any;
      if (!user || !user._id) continue;

      const key          = `${user._id}-${dateKey}`;
      const logTimestamp = log.timeOut ?? log.timeIn ?? log.date;

      if (!grouped[key]) {
        grouped[key] = { _id: key, date: log.date, user: log.userId, dailyStatus: log.status, _latestTime: logTimestamp, attendance: null, activities: [] };
      }

      if (log.reason === "attendance") {
        grouped[key].attendance = { timeIn: log.timeIn, timeOut: log.timeOut, status: log.status };
      } else {
        // checkin / checkout / break / go out
        grouped[key].activities.push({
          reason:  log.reason,
          timeIn:  log.timeIn  || null,
          timeOut: log.timeOut || null,
          status:  log.status,
        });
      }

      if (logTimestamp > grouped[key]._latestTime) { grouped[key].dailyStatus = log.status; grouped[key]._latestTime = logTimestamp; }
    }

    const result  = Object.values(grouped).map(({ _latestTime, ...rest }) => rest);
    const userIds = Array.from(new Set(result.filter((e: any) => e.user?._id).map((e: any) => e.user._id.toString())));
    const qrCodes = userIds.length ? await QRCode.find({ userId: { $in: userIds } }).select("userId qrString").lean() : [];
    const qrMap   = new Map(qrCodes.map((qr: any) => [qr.userId.toString(), qr.qrString]));
    for (const entry of result) {
      if (entry.user?._id) entry.user = { ...entry.user, qrString: qrMap.get(entry.user._id.toString()) || null };
    }

    // Attach Attendance model records for Staff
    if (req.user.role === "Staff" && result.length) {
      const minDate = new Date(Math.min(...result.map((e: any) => new Date(e.date).getTime()))); minDate.setHours(0,0,0,0);
      const maxDate = new Date(Math.max(...result.map((e: any) => new Date(e.date).getTime()))); maxDate.setHours(23,59,59,999);
      const attends = await Attendance.find({ staffId: req.user.id, date: { $gte: minDate, $lte: maxDate } }).lean();
      const attMap  = new Map<string, any>();
      for (const a of attends) attMap.set(`${(a.staffId as any).toString()}-${new Date(a.date).toISOString().split("T")[0]}`, a);
      for (const entry of result) {
        if (!entry.attendance && entry.user?._id) {
          const a = attMap.get(`${entry.user._id.toString()}-${new Date(entry.date).toISOString().split("T")[0]}`);
          if (a) entry.attendance = { timeIn: a.timeIn, timeOut: a.timeOut, status: a.timeOut ? "Checked Out" : "In TUP" };
        }
      }
    }

    return res.json(result);
  },
);

// ─── GET MY TRANSACTIONS (both directions — I scanned + scanned me) ───────────
export const getMyTransactions = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const allowedRoles = ["Student", "Visitor", "Staff"];
    if (!allowedRoles.includes(req.user?.role)) return next(new AppError("Access denied.", 403));

    // KEY FIX: use transId presence to identify real visit scans, not reason string
    const logs = await Log.find({
      $or: [
        { userId:  req.user.id, transId: { $exists: true } }, // I scanned someone
        { transId: req.user.id },                              // someone scanned me
      ],
    })
      .populate({ path: "userId",  select: "firstName surname role photoURL", options: { lean: true } })
      .populate({ path: "transId", select: "firstName surname role photoURL", options: { lean: true } })
      .populate({ path: "qrId",    select: "qrString",                        options: { lean: true } })
      .sort({ date: -1, timeIn: -1 })
      .lean();

    const myId = req.user.id.toString();

    const result = logs.map((log: any) => {
      const scanner      = log.userId  as any;
      const scanned      = log.transId as any;
      const iWasScanner  = scanner?._id?.toString() === myId;

      return {
        _id:       log._id,
        date:      log.date,
        timeIn:    log.timeIn  || null,
        timeOut:   log.timeOut || null,
        status:    log.status,
        reason:    log.reason,
        scannedAt: log.timeIn || log.timeOut || log.date,
        direction: iWasScanner ? "outgoing" : "incoming",
        otherParty: iWasScanner
          ? (scanned  ? { firstName: scanned.firstName,  surname: scanned.surname,  role: scanned.role,  photoURL: scanned.photoURL  } : null)
          : (scanner  ? { firstName: scanner.firstName,  surname: scanner.surname,  role: scanner.role,  photoURL: scanner.photoURL  } : null),
        scannedQrString: (log.qrId as any)?.qrString || null,
      };
    });

    return res.json(result);
  },
);
