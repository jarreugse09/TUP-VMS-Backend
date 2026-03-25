import { Request, Response, type NextFunction } from "express";
import Log from "../models/Log";
import Activity from "../models/Activity";
import User from "../models/User";
import QRCode from "../models/QRCode";
import Attendance from "../models/Attendance";
import { catchAsync } from "../utils/catchAsync";
import { AppError } from "../utils/AppError";

interface AuthRequest extends Request {
  user?: any;
}

/*
export const scanQR = async (req: AuthRequest, res: Response) => {
  const { qrString, mode, reason } = req.body; // mode: 'checkin' or 'checkout'

  const reasonType = ['break', 'go out', 'attendance',]


  try {
    const qrCode = await QRCode.findOne({ qrString });
    if (!reason) return res.status(404).json({ message: "Reason is required. Please provide a reason" });
    if (!qrCode) {
      return res.status(404).json({ message: "QR code not found" });
    }

    const user = await User.findById(qrCode.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (mode === "checkin") {
      // Check if already checked in
      const existingLog = await Log.findOne({
        userId: user._id,
        date: { $gte: today },
        timeOut: null,
      });

      if (existingLog) {
        return res.status(400).json({ message: "User already checked in" });
      }

      const log = new Log({
        userId: user._id,
        qrId: qrCode._id,
        date: new Date(),
        timeIn: new Date(),
        status: "In TUP",
        scannedBy: req.user.id,
      });

      await log.save();

      // If staff, create attendance
      if (user.role === "Staff") {
        const attendance = new Attendance({
          staffId: user._id,
          date: new Date(),
          timeIn: new Date(),
        });
        await attendance.save();
      }

      user.status = "In TUP";
      await user.save();

      res.json({ message: "Check-in successful", log });
    } else if (mode === "checkout") {
      const log = await Log.findOne({
        userId: user._id,
        date: { $gte: today },
        timeOut: null,
      });

      if (!log) {
        return res.status(400).json({ message: "No active check-in found" });
      }

      log.timeOut = new Date();
      log.status = "Checked Out";
      await log.save();

      // Update attendance if staff
      if (user.role === "Staff") {
        const attendance = await Attendance.findOne({
          staffId: user._id,
          date: { $gte: today },
          timeOut: null,
        });
        if (attendance) {
          attendance.timeOut = new Date();
          attendance.totalHours =
            (attendance.timeOut.getTime() - attendance.timeIn.getTime()) /
            (1000 * 60 * 60);
          await attendance.save();
        }
      }

      user.status = "Active";
      await user.save();

      res.json({ message: "Check-out successful", log });
    }
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};
*/

// ADMIN and security scan
export const scanQR = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    // =========================
    // 1. REQUEST VALIDATION
    // =========================
    const { qrString, mode, reason, approvedBy } = req.body;

    // Required fields
    if (!qrString || !mode || !reason) {
      return next(new AppError("Invalid empty field/s", 400));
    }

    // =========================
    // 2. QR CODE VALIDATION
    // =========================
    const qrCode = await QRCode.findOne({ qrString });
    if (!qrCode) {
      return next(new AppError("QR code not found", 404));
    }

    // Identify the owner of the QR code
    const user = await User.findById(qrCode.userId);
    if (!user) {
      return next(new AppError("User not found", 404));
    }

    // Create a sanitized user object to include in responses (avoid sensitive fields)
    const safeUser = {
      _id: user._id,
      firstName: user.firstName,
      surname: user.surname,
      role: user.role,
      photoURL: user.photoURL,
      status: user.status,
      staffType: user.staffType,
    };

    // =========================
    // 3. DATE (TODAY ONLY)
    // =========================
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // =====================================================
    // 4. STUDENT / VISITOR FLOW
    // =====================================================
    if (user.role === "Student" || user.role === "Visitor") {
      // ---------- CHECK-IN ----------
      if (mode === "checkin") {
        // Check if already checked in today (must have no timeOut AND current status is "In TUP")
        const existingLog = await Log.findOne({
          userId: user._id,
          date: { $gte: today },
          timeOut: null,
          status: "In TUP", // Only check in if there's no active "In TUP" log
        });

        if (existingLog) {
          return next(new AppError("User already check in", 400));
        }

        // Create new check-in log
        const log = new Log({
          userId: user._id,
          qrId: qrCode._id,
          date: new Date(),
          timeIn: new Date(),
          status: "In TUP",
          reason: "transaction",
          scannedBy: req.user.id,
        });

        const savedLog = await log.save();
        
        if (!savedLog) {
          return next(new AppError("Failed to check in. Please try again.", 400));
        }

        return res
          .status(201)
          .json({ message: "Checked In Successfully", user: safeUser });
      }

      // ---------- CHECK-OUT ----------
      else if (mode === "checkout") {
        // Find active check-in with explicit status check
        const existingLog = await Log.findOne({
          userId: user._id,
          date: { $gte: today },
          timeOut: null,
          status: { $ne: "Checked Out" }, // Ensure not already checked out
        });

        if (!existingLog) {
          return next(new AppError("User must check in first!", 400));
        }

        // Update checkout with updateOne to ensure atomicity
        const updateResult = await Log.updateOne(
          { _id: existingLog._id },
          {
            $set: {
              timeOut: new Date(),
              status: "Checked Out",
            },
          }
        );

        if (updateResult.modifiedCount === 0) {
          return next(new AppError("Failed to checkout. Please try again.", 400));
        }

        return res
          .status(201)
          .json({ message: "Checked Out Successfully", user: safeUser });
      }
    }

    // =====================================================
    // 5. STAFF / TUP FLOW
    // =====================================================
    else if (user.role === "Staff" || user.role === "TUP") {
      // ======================
      // CHECK-IN MODE
      // ======================
      if (mode === "checkin") {
        // ---------- ATTENDANCE ----------
        if (reason === "attendance") {
          // Check existing attendance
          const attend = await Attendance.findOne({
            staffId: user._id,
            date: { $gte: today },
            timeOut: null,
          });

          if (attend) {
            return next(new AppError("User already attended.", 400));
          }

          // Create attendance
          const newAttend = await Attendance.create({
            staffId: user._id,
            date: new Date(),
            timeIn: new Date(),
            scannedBy: req.user.id,
          });

          if (!newAttend) {
            return next(new AppError("Attendance creation failed.", 404));
          }

          // Create attendance log
          const newLog = await Log.create({
            userId: user._id,
            qrId: qrCode._id,
            date: new Date(),
            timeIn: new Date(),
            status: "In TUP",
            reason: "attendance",
            scannedBy: req.user.id,
          });

          if (!newLog) {
            return next(new AppError("Saving Log failed.", 404));
          }

          return res.status(200).json({
            message: "Attendance check-in successful",
            attendance: newAttend,
            log: newLog,
            user: safeUser,
          });
        }

        // ---------- BREAK / GO OUT (RETURN) ----------
        else if (reason === "go out") {
          // Check latest checked-out log with same reason
          const existingLog = await Log.findOne({
            userId: user._id,
            status: "Checked Out",
            reason: "go out",
            timeOut: { $gte: today },
          });

          if (existingLog) {
            // Modify existing log (return from break/go out)
            existingLog.timeIn = new Date();
            existingLog.status = "In TUP";
            await existingLog.save();

            return res.status(200).json({
              message: "Check-in successful",
              log: existingLog,
              user: safeUser,
            });
          } else {
            // Create new log
            const newLog = await Log.create({
              userId: user._id,
              qrId: qrCode._id,
              date: new Date(),
              timeIn: new Date(),
              timeOut: null,
              reason: reason,
              status: "In TUP",
              scannedBy: req.user.id,
            });

            if (!newLog) {
              return next(new AppError("New Log creation failed.", 400));
            }
          }
        } else if (reason === "break") {
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

            return res.status(200).json({
              message: "Break return successful",
              log: existingLog,
            });
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

            return res.status(201).json({
              message: "Break check-in successful",
              log: newLog,
              user: safeUser,
            });
          }
        } else {
          return next(new AppError("Invalid reason", 500));
        }
      }

      // ======================
      // CHECK-OUT MODE
      // ======================
      else if (mode === "checkout") {
        // ---------- ATTENDANCE CHECKOUT ----------
        if (reason === "attendance") {
          // Find active attendance log
          const log = await Log.findOne({
            userId: user._id,
            date: { $gte: today },
            status: "In TUP",
            reason: "attendance",
            timeOut: null,
          });

          if (!log) {
            return next(new AppError("No active check-in found", 400));
          }

          // Close log
          log.timeOut = new Date();
          log.status = "Checked Out";
          await log.save();

          // Close attendance
          const existingAttendance = await Attendance.findOne({
            staffId: user._id,
            date: { $gte: today },
            timeOut: null,
          });

          if (!existingAttendance) {
            return next(new AppError("No active check-in", 400));
          }

          existingAttendance.timeOut = new Date();
          await existingAttendance.save();

          return res.status(201).json({
            status: "success",
            message: "Check out successful.",
            user: safeUser,
          });
        } else if (reason === "break") {
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

          if (!newLog) {
            return next(new AppError("Saving log failed.", 404));
          }

          return res.status(201).json({
            status: "success",
            message: "Check out successful.",
            user: safeUser,
          });
        }
        // ---------- GO OUT ----------
        else if (reason === "go out") {
          // MAINTENANCE / STARCOM
          if (user.role === "Staff" && user.staffType === "Maintenance") {
            if (!approvedBy) {
              return next(
                new AppError(
                  "Please provide the person who approved to go out.",
                  404,
                ),
              );
            }

            const newLog = await Log.create({
              userId: user._id,
              qrId: qrCode._id,
              date: new Date(),
              timeOut: new Date(),
              status: "Checked Out",
              reason: "go out",
              scannedBy: req.user.id,
              approvedBy: approvedBy,
            });

            if (!newLog) {
              return next(new AppError("Saving log failed.", 404));
            }

            return res.status(201).json({
              status: "success",
              message: "Check out successful.",
            });
          }

          // OTHER STAFF
          else {
            const newLog = await Log.create({
              userId: user._id,
              qrId: qrCode._id,
              date: new Date(),
              timeOut: new Date(),
              status: "Checked Out",
              reason: "go out",
              scannedBy: req.user.id,
            });

            if (!newLog) {
              return next(new AppError("Saving log failed.", 404));
            }

            return res.status(201).json({
              status: "success",
              message: "Check out successful.",
            });
          }
        } else {
          return next(new AppError("Invalid reason", 500));
        }
      }
    }
  },
);

// ================================
// STAFF ↔ STAFF TRANSACTION SCAN
// ================================
export const scanTransactionQR = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    // =========================
    // 1. REQUEST VALIDATION
    // =========================
    const { qrString, mode, type } = req.body;

    // Required fields and correct transaction type
    if (!qrString || !mode || type !== "Transaction") {
      return next(new AppError("Invalid empty fields.", 400));
    }

    // =========================
    // 2. QR CODE VALIDATION
    // =========================
    const qrCode = await QRCode.findOne({ qrString });
    if (!qrCode) {
      return next(new AppError("QR code not found", 404));
    }

    // Identify the staff being scanned (transaction target)
    const user = await User.findById(qrCode.userId);
    if (!user) {
      return next(new AppError("User not found", 404));
    }

    // =========================
    // 3. DATE (TODAY ONLY)
    // =========================
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // =========================
    // 4. ACCESS CONTROL
    // =========================
    // Only STAFF can scan transaction QR codes
    if (req.user?.role !== "Staff") {
      return next(new AppError("Invalid access", 500));
    }

    // =====================================================
    // 5. CHECK-IN TRANSACTION
    // =====================================================
    if (mode === "checkin" && type === "Transaction") {
      // Look for existing transaction log today
      const existingLog = await Log.findOne({
        userId: req.user.id, // staff who scanned
        transId: user._id, // staff being scanned
        qrId: qrCode._id,
        status: "Transaction",
        reason: type,
        date: { $gte: today },
        scannedBy: req.user.id,
        timeIn: null,
      });

      // If found, update the time-in
      if (existingLog) {
        existingLog.timeIn = new Date();
        await existingLog.save();
      }

      // Always create a new transaction log (as per current logic)
      const newLog = await Log.create({
        userId: req.user.id, // staff who scanned
        transId: user._id, // staff scanned
        qrId: qrCode._id,
        status: type,
        reason: type,
        scannedBy: req.user.id,
        timeOut: null,
        date: today,
        timeIn: new Date(),
      });

      if (!newLog) {
        return next(new AppError("Error Transaction. Please try again", 404));
      }

      return res.status(201).json({
        status: "success",
        message: "Transaction check-in.",
      });
    }

    // =====================================================
    // 6. CHECK-OUT TRANSACTION
    // =====================================================
    else if (mode === "checkout" && type === "Transaction") {
      // Look for existing active transaction log today
      const existingLog = await Log.findOne({
        userId: req.user.id, // staff who scanned
        transId: user._id, // staff scanned
        qrId: qrCode._id,
        status: "Transaction",
        reason: type,
        date: { $gte: today },
        scannedBy: req.user.id,
        timeOut: null,
      });

      // If found, update the time-out
      if (existingLog) {
        existingLog.timeOut = new Date();
        await existingLog.save();
      }

      // Always create a new checkout transaction log (as per current logic)
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

      if (!newLog) {
        return next(new AppError("Error Transaction. Please try again", 404));
      }

      return res.status(201).json({
        status: "success",
        message: "Transaction check-out.",
      });
    }
  },
);

// =========================================
// VISITOR / STUDENT → STAFF TRANSACTION SCAN
// =========================================
export const visitorScanQR = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    // =========================
    // 1. REQUEST VALIDATION
    // =========================
    const { qrString, type } = req.body;

    // Required fields and enforced transaction type
    if (!qrString || type !== "Transaction") {
      return next(new AppError("Invalid empty fields.", 400));
    }

    // =========================
    // 2. QR CODE VALIDATION
    // =========================
    const qrCode = await QRCode.findOne({ qrString });
    if (!qrCode) {
      return next(new AppError("QR code not found", 404));
    }

    // Identify the target being scanned (transaction target)
    const targetUser = await User.findOne({ _id: qrCode.userId });
    if (!targetUser) {
      return next(new AppError("User not found", 404));
    }

    // =========================
    // 3. ACCESS CONTROL
    // =========================
    // Visitors, Students, and Staff are allowed to use this transaction scanner
    if (
      req.user?.role !== "Visitor" &&
      req.user?.role !== "Student" &&
      req.user?.role !== "Staff"
    ) {
      return next(new AppError("Invalid access", 500));
    }

    // =========================
    // 4. TRANSACTION LOGGING (NO CHECK-IN/CHECK-OUT)
    // =========================
    // For normal users, scanning only records a transaction
    // Check-in/check-out is controlled exclusively by admin scans
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const newLog = await Log.create({
      userId: req.user.id, // authenticated user who scanned
      transId: targetUser._id, // target being scanned
      qrId: qrCode._id,
      status: "Transaction", // Always transaction for user scans
      reason: "transaction",
      scannedBy: req.user.id,
      date: today,
      timeIn: new Date(), // Record the time of scan
    });

    if (!newLog) {
      return next(new AppError("Error recording transaction. Please try again", 404));
    }

    return res.status(201).json({
      status: "success",
      message: "Transaction recorded successfully",
      user: {
        _id: targetUser._id,
        firstName: targetUser.firstName,
        surname: targetUser.surname,
        role: targetUser.role,
        photoURL: targetUser.photoURL,
        status: targetUser.status,
      },
    });
  }
);

export const recordActivity = async (req: AuthRequest, res: Response) => {
  const { toQR, activityType } = req.body;

  try {
    const fromUser = await User.findById(req.user.id);
    const toQRCode = await QRCode.findOne({ qrString: toQR });
    if (!toQRCode) {
      return res.status(404).json({ message: "Target QR not found" });
    }

    const toUser = await User.findById(toQRCode.userId);
    if (!toUser) {
      return res.status(404).json({ message: "Target user not found" });
    }

    const fromQRCode = await QRCode.findOne({ userId: req.user.id });

    const activity = new Activity({
      fromUserId: req.user.id,
      toUserId: toUser._id,
      fromQR: fromQRCode?.qrString || "",
      toQR,
      activityType,
    });

    await activity.save();

    res.json({ message: "Activity recorded" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

// export const getLogs = async (req: AuthRequest, res: Response) => {
//   try {
//     const logs = await Log.find()
//       .populate("userId", "firstName surname role photoURL")
//       .populate("scannedBy", "firstName surname")
//       .sort({ date: -1 });
//     res.json(logs);
//   } catch (error) {
//     res.status(500).json({ message: "Server error" });
//   }
// };

export const getLogs = catchAsync(async (req: AuthRequest, res: Response) => {
  const logs = await Log.find()
    .populate({
      path: "userId",
      select: "firstName surname role photoURL birthdate",
      options: { lean: true },
    })
    .sort({ date: -1, timeIn: -1 })
    .lean();

  const grouped: Record<string, any> = {};

  for (const log of logs) {
    const dateKey = log.date.toISOString().split("T")[0];
    const user = log.userId as any;
    if (!user || !user._id) {
      console.warn("Skipping log with missing user reference", log._id);
      continue;
    }
    const key = `${user._id}-${dateKey}`;

    // choose the most accurate timestamp for ordering
    const logTimestamp = log.timeOut ?? log.timeIn ?? log.date;

    if (!grouped[key]) {
      grouped[key] = {
        _id: key,
        date: log.date,
        user: log.userId,

        dailyStatus: log.status,
        _latestTime: logTimestamp,

        attendance: null,
        activities: [],
      };
    }

    if (log.reason === "attendance") {
      grouped[key].attendance = {
        timeIn: log.timeIn,
        timeOut: log.timeOut,
        status: log.status,
      };
    } else if (log.reason) {
      grouped[key].activities.push({
        reason: log.reason,
        timeIn: log.timeIn,
        timeOut: log.timeOut,
        status: log.status,
      });
    }

    /** ---------- DAILY STATUS (LATEST LOG WINS) ---------- */
    if (logTimestamp > grouped[key]._latestTime) {
      grouped[key].dailyStatus = log.status;
      grouped[key]._latestTime = logTimestamp;
    }
  }

  // remove internal helper field
  const result = Object.values(grouped).map(({ _latestTime, ...rest }) => rest);

  const userIds = Array.from(
    new Set(
      result
        .filter((entry: any) => entry.user && entry.user._id)
        .map((entry: any) => entry.user._id.toString()),
    ),
  );

  const qrCodes = userIds.length
    ? await QRCode.find({ userId: { $in: userIds } })
        .select("userId qrString")
        .lean()
    : [];
  const qrMap = new Map(
    qrCodes.map((qr: any) => [qr.userId.toString(), qr.qrString]),
  );

  for (const entry of result) {
    if (entry.user && entry.user._id) {
      entry.user = {
        ...entry.user,
        qrString: qrMap.get(entry.user._id.toString()) || null,
      };
    }
  }

  // Prefetch attendance for staff users to avoid N+1 queries
  const staffIds = Array.from(
    new Set(
      result
        .filter((e: any) => e.user && e.user.role === "Staff")
        .map((e: any) => e.user._id.toString()),
    ),
  );

  if (staffIds.length) {
    const minDate = new Date(
      Math.min(...result.map((e: any) => new Date(e.date).getTime())),
    );
    minDate.setHours(0, 0, 0, 0);
    const maxDate = new Date(
      Math.max(...result.map((e: any) => new Date(e.date).getTime())),
    );
    maxDate.setHours(23, 59, 59, 999);

    const attends = await Attendance.find({
      staffId: { $in: staffIds },
      date: { $gte: minDate, $lte: maxDate },
    }).lean();

    const attMap = new Map<string, any>();
    for (const a of attends) {
      const key = `${(a.staffId as any).toString()}-${new Date(a.date).toISOString().split("T")[0]}`;
      attMap.set(key, a);
    }

    for (const entry of result) {
      if (!entry.attendance && entry.user && entry.user.role === "Staff") {
        const k = `${entry.user._id.toString()}-${new Date(entry.date).toISOString().split("T")[0]}`;
        const a = attMap.get(k);
        if (a) {
          entry.attendance = {
            timeIn: a.timeIn,
            timeOut: a.timeOut,
            status: a.timeOut ? "Checked Out" : "In TUP",
          };
        }
      }
    }
  }

  res.json(result);
});

export const getStaffLogs = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const logs = await Log.find({ userId: req.user.id })
      .populate({
        path: "userId",
        select: "firstName surname role photoURL birthdate",
        options: { lean: true },
      })
      .populate({
        path: "transId",
        select: "firstName surname role",
        options: { lean: true },
      })
      .populate({
        path: "qrId",
        select: "qrString userId",
        options: { lean: true },
      })
      .sort({ date: -1, timeIn: -1 })
      .lean();

    const grouped: Record<string, any> = {};

    for (const log of logs) {
      const dateKey = log.date.toISOString().split("T")[0];
      const user = log.userId as any;
      if (!user || !user._id) {
        console.warn("Skipping log with missing user reference", log._id);
        continue;
      }
      const key = `${user._id}-${dateKey}`;

      // choose the most accurate timestamp for ordering
      const logTimestamp = log.timeOut ?? log.timeIn ?? log.date;

      if (!grouped[key]) {
        grouped[key] = {
          _id: key,
          date: log.date,
          user: log.userId,

          dailyStatus: log.status,
          _latestTime: logTimestamp,

          attendance: null,
          activities: [],
        };
      }

      if (log.reason === "attendance") {
        grouped[key].attendance = {
          timeIn: log.timeIn,
          timeOut: log.timeOut,
          status: log.status,
        };
      } else if (log.reason) {
        const scannedPerson = log.transId as any;
        const scannedQR = log.qrId as any;
        grouped[key].activities.push({
          reason: log.reason,
          timeIn: log.timeIn,
          timeOut: log.timeOut,
          status: log.status,
          scannedQrString: scannedQR?.qrString || null,
          scannedTarget: scannedPerson
            ? {
                firstName: scannedPerson.firstName,
                surname: scannedPerson.surname,
                role: scannedPerson.role,
              }
            : null,
          scannedAt: log.timeIn || log.timeOut || log.date,
        });
      }

      /** ---------- DAILY STATUS (LATEST LOG WINS) ---------- */
      if (logTimestamp > grouped[key]._latestTime) {
        grouped[key].dailyStatus = log.status;
        grouped[key]._latestTime = logTimestamp;
      }
    }

    // remove internal helper field
    const result = Object.values(grouped).map(
      ({ _latestTime, ...rest }) => rest,
    );

    const userIds = Array.from(
      new Set(
        result
          .filter((entry: any) => entry.user && entry.user._id)
          .map((entry: any) => entry.user._id.toString()),
      ),
    );

    const qrCodes = userIds.length
      ? await QRCode.find({ userId: { $in: userIds } })
          .select("userId qrString")
          .lean()
      : [];
    const qrMap = new Map(
      qrCodes.map((qr: any) => [qr.userId.toString(), qr.qrString]),
    );

    for (const entry of result) {
      if (entry.user && entry.user._id) {
        entry.user = {
          ...entry.user,
          qrString: qrMap.get(entry.user._id.toString()) || null,
        };
      }
    }

    if (!result.length) {
      return res.json([]);
    }

    // Prefetch attendance for this staff to avoid N+1
    const minDate = new Date(
      Math.min(...result.map((e: any) => new Date(e.date).getTime())),
    );
    minDate.setHours(0, 0, 0, 0);
    const maxDate = new Date(
      Math.max(...result.map((e: any) => new Date(e.date).getTime())),
    );
    maxDate.setHours(23, 59, 59, 999);

    const attends = await Attendance.find({
      staffId: req.user.id,
      date: { $gte: minDate, $lte: maxDate },
    }).lean();

    const attMap = new Map<string, any>();
    for (const a of attends) {
      const key = `${(a.staffId as any).toString()}-${new Date(a.date).toISOString().split("T")[0]}`;
      attMap.set(key, a);
    }

    for (const entry of result) {
      if (!entry.attendance && entry.user && entry.user.role === "Staff") {
        const k = `${entry.user._id.toString()}-${new Date(entry.date).toISOString().split("T")[0]}`;
        const a = attMap.get(k);
        if (a) {
          entry.attendance = {
            timeIn: a.timeIn,
            timeOut: a.timeOut,
            status: a.timeOut ? "Checked Out" : "In TUP",
          };
        }
      }
    }

    res.json(result);
  },
);

// Get individual transaction logs for users (not grouped, one row per transaction)
export const getUserTransactions = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const transactionLogs = await Log.find({
      userId: req.user.id,
      status: "Transaction", // Only transactions, exclude attendance
    })
      .populate({
        path: "transId",
        select: "firstName surname role",
        options: { lean: true },
      })
      .populate({
        path: "qrId",
        select: "qrString",
        options: { lean: true },
      })
      .sort({ date: -1, timeIn: -1 })
      .lean();

    // Transform to flat list of transactions
    const result = transactionLogs.map((log: any) => ({
      _id: log._id,
      date: log.date,
      timeIn: log.timeIn,
      timeOut: log.timeOut,
      status: log.status,
      reason: log.reason,
      scannedTarget: log.transId
        ? {
            firstName: log.transId.firstName,
            surname: log.transId.surname,
            role: log.transId.role,
          }
        : null,
      scannedQRString: log.qrId?.qrString || null,
      scannedAt: log.timeIn || log.timeOut || log.date,
    }));

    res.json(result);
  },
);

// Get user's attendance records (when admin scanned them for check-in/check-out)
export const getUserAttendance = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const attendanceRecords = await Attendance.find({ staffId: req.user.id })
      .sort({ date: -1 })
      .lean();

    // Transform to include readable format
    const result = attendanceRecords.map((record: any) => ({
      _id: record._id,
      date: record.date,
      timeIn: record.timeIn,
      timeOut: record.timeOut,
      status: record.timeOut ? "Checked Out" : "In TUP",
      scannedBy: record.scannedBy,
    }));

    res.json(result);
  },
);

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

// Export logs with password verification and CSV/XLSX support
export const exportLogs = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { startDate, endDate, month, format } = req.body;
    const { password } = req.body;

    if (!password || !format) {
      return next(new AppError("Password and format are required", 400));
    }

    // verify password
    const user = await User.findById(req.user.id).select("+passwordHash");
    if (!user) return next(new AppError("User not found", 404));

    const isMatch = await require("bcryptjs").compare(
      password,
      user.passwordHash,
    );
    if (!isMatch) return next(new AppError("Invalid password", 401));

    // determine date range
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

    // construct query
    let query: any = {
      date: { $gte: start, $lte: end },
      reason: "attendance",
    };

    // if not TUP (admin), limit to own logs only
    if (req.user.role !== "TUP") {
      query.userId = req.user.id;
    }

    const logs = await Log.find(query)
      .populate("userId", "firstName surname role")
      .sort({ date: -1 });

    // Group by user+date to get timeIn/timeOut/status
    const grouped: Record<string, any> = {};
    for (const log of logs) {
      const dateKey = log.date.toISOString().split("T")[0];
      const user = log.userId as any;
      if (!user || !user._id) {
        console.warn("Skipping log with missing user reference", log._id);
        continue;
      }
      const key = `${user._id}-${dateKey}`;
      const logTimestamp = log.timeOut ?? log.timeIn ?? log.date;

      if (!grouped[key]) {
        grouped[key] = {
          date: dateKey,
          name: `${user.firstName} ${user.surname}`,
          role: user.role,
          timeIn: null,
          timeOut: null,
          status: log.status,
          _latestTime: logTimestamp,
        };
      }

      if (log.reason === "attendance") {
        if (log.timeIn) grouped[key].timeIn = log.timeIn;
        if (log.timeOut) grouped[key].timeOut = log.timeOut;
      }

      if (logTimestamp > grouped[key]._latestTime) {
        grouped[key].status = log.status;
        grouped[key]._latestTime = logTimestamp;
      }
    }

    const rows = Object.values(grouped).map((r: any) => ({
      Date: r.date,
      Name: r.name,
      Role: r.role,
      "Time In": r.timeIn ? r.timeIn.toISOString() : "",
      "Time Out": r.timeOut ? r.timeOut.toISOString() : "",
      Status: r.status,
    }));

    // export
    const filenameBase = `logs_${start.toISOString().split("T")[0]}_to_${end.toISOString().split("T")[0]}`;

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
      const sheet = workbook.addWorksheet("Logs");
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
export const getMyLogs = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
 
    // ── 1. Role guard ──────────────────────────────────────────────────────
    const allowedRoles = ["Student", "Visitor", "Staff"];
    if (!allowedRoles.includes(req.user?.role)) {
      return next(new AppError("Access denied.", 403));
    }
 
    // ── 2. Fetch this user's logs only ────────────────────────────────────
    const logs = await Log.find({ userId: req.user.id })
      .populate({
        path: "userId",
        select: "firstName surname role photoURL birthdate",
        options: { lean: true },
      })
      .populate({
        path: "transId",                    // the staff/registrar they visited
        select: "firstName surname role",
        options: { lean: true },
      })
      .populate({
        path: "qrId",
        select: "qrString userId",
        options: { lean: true },
      })
      .sort({ date: -1, timeIn: -1 })
      .lean();
 
    // ── 3. Group by user + date (same pattern as getStaffLogs) ───────────
    const grouped: Record<string, any> = {};
 
    for (const log of logs) {
      const dateKey = log.date.toISOString().split("T")[0];
      const user    = log.userId as any;
 
      if (!user || !user._id) {
        console.warn("getMyLogs: skipping log with missing user ref", log._id);
        continue;
      }
 
      const key          = `${user._id}-${dateKey}`;
      const logTimestamp = log.timeOut ?? log.timeIn ?? log.date;
 
      if (!grouped[key]) {
        grouped[key] = {
          _id:         key,
          date:        log.date,
          user:        log.userId,
          dailyStatus: log.status,
          _latestTime: logTimestamp,
          attendance:  null,
          activities:  [],
        };
      }
 
      // ── Attendance entry (Staff only) ──────────────────────────────────
      if (log.reason === "attendance") {
        grouped[key].attendance = {
          timeIn:  log.timeIn,
          timeOut: log.timeOut,
          status:  log.status,
        };
      }
 
      // ── "Went to" transaction entry (Student / Visitor / Staff) ────────
     else if (log.reason === "transaction" || log.reason === "Transaction") {

        const scannedPerson = log.transId as any;
        const scannedQR     = log.qrId    as any;
 
        grouped[key].activities.push({
          reason:       "transaction",
          // Who they visited — shown as "Went to: [name + role]"
          wentTo: scannedPerson
            ? {
                firstName: scannedPerson.firstName,
                surname:   scannedPerson.surname,
                role:      scannedPerson.role,
              }
            : null,
          scannedQrString: scannedQR?.qrString || null,
          timeIn:          log.timeIn  || null,
          timeOut:         log.timeOut || null,
          status:          log.status,
          scannedAt:       log.timeIn || log.timeOut || log.date,
        });
      }
 
      // ── break / go out (Staff only, for completeness) ──────────────────
      else if (log.reason) {
        grouped[key].activities.push({
          reason:  log.reason,
          wentTo:  null,
          timeIn:  log.timeIn  || null,
          timeOut: log.timeOut || null,
          status:  log.status,
          scannedAt: log.timeIn || log.timeOut || log.date,
        });
      }
 
      // ── Daily status: latest log wins ──────────────────────────────────
      if (logTimestamp > grouped[key]._latestTime) {
        grouped[key].dailyStatus = log.status;
        grouped[key]._latestTime = logTimestamp;
      }
    }
 
    // ── 4. Strip internal helper field ───────────────────────────────────
    const result = Object.values(grouped).map(
      ({ _latestTime, ...rest }) => rest,
    );
 
    // ── 5. Attach qrString to user object (same as getLogs) ──────────────
    const userIds = Array.from(
      new Set(
        result
          .filter((e: any) => e.user && e.user._id)
          .map((e: any) => e.user._id.toString()),
      ),
    );
 
    const qrCodes = userIds.length
      ? await QRCode.find({ userId: { $in: userIds } })
          .select("userId qrString")
          .lean()
      : [];
 
    const qrMap = new Map(
      qrCodes.map((qr: any) => [qr.userId.toString(), qr.qrString]),
    );
 
    for (const entry of result) {
      if (entry.user && entry.user._id) {
        entry.user = {
          ...entry.user,
          qrString: qrMap.get(entry.user._id.toString()) || null,
        };
      }
    }
 
    // ── 6. Attach Attendance records for Staff ────────────────────────────
    if (req.user.role === "Staff" && result.length) {
      const minDate = new Date(
        Math.min(...result.map((e: any) => new Date(e.date).getTime())),
      );
      minDate.setHours(0, 0, 0, 0);
 
      const maxDate = new Date(
        Math.max(...result.map((e: any) => new Date(e.date).getTime())),
      );
      maxDate.setHours(23, 59, 59, 999);
 
      const attends = await Attendance.find({
        staffId: req.user.id,
        date: { $gte: minDate, $lte: maxDate },
      }).lean();
 
      const attMap = new Map<string, any>();
      for (const a of attends) {
        const k = `${(a.staffId as any).toString()}-${new Date(a.date)
          .toISOString()
          .split("T")[0]}`;
        attMap.set(k, a);
      }
 
      for (const entry of result) {
        if (!entry.attendance) {
          const k = `${entry.user._id.toString()}-${new Date(entry.date)
            .toISOString()
            .split("T")[0]}`;
          const a = attMap.get(k);
          if (a) {
            entry.attendance = {
              timeIn:  a.timeIn,
              timeOut: a.timeOut,
              status:  a.timeOut ? "Checked Out" : "In TUP",
            };
          }
        }
      }
    }
 
    return res.json(result);
  },
);