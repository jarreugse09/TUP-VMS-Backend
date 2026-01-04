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

        // Check if already checked in today (scanned by guard/admin)
        const existingLog = await Log.findOne({
          userId: user._id,
          date: { $gte: today },
          timeOut: null,
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
          scannedBy: req.user.id,
        });

        await log.save();
      }

      // ---------- CHECK-OUT ----------
      else if (mode === "checkout") {

        // Find active check-in
        const existingLog = await Log.findOne({
          userId: user._id,
          date: { $gte: today },
          timeOut: null,
        });

        if (!existingLog) {
          return next(new AppError("User must check in first!", 400));
        }

        // Modify checkout
        existingLog.timeOut = new Date();
        existingLog.status = "Checked Out";
        await existingLog.save();
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
          });
        }

        // ---------- BREAK / GO OUT (RETURN) ----------
        else if (reason === "go out" || reason === "break") {

          // Check latest checked-out log with same reason
          const existingLog = await Log.findOne({
            userId: user._id,
            status: "Checked Out",
            reason: { $in: ["break", "go out"] },
            timeOut: { $gte: today },
          });

          if (existingLog) {
            // Modify existing log (return from break/go out)
            existingLog.timeIn = new Date();
            existingLog.status = "In TUP";
            await existingLog.save();
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
                  404
                )
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
        }
      }
    }
  }
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
        userId: req.user.id,        // staff who scanned
        transId: user._id,           // staff being scanned
        qrId: qrCode.id,
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
        userId: req.user.id,        // staff who scanned
        transId: user._id,           // staff scanned
        qrId: qrCode.id,
        status: type,
        reason: type,
        scannedBy: req.user.id,
        timeOut: null,
        date: today,
        timeIn: new Date(),
      });

      if (!newLog) {
        return next(
          new AppError("Error Transaction. Please try again", 404)
        );
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
        userId: req.user.id,        // staff who scanned
        transId: user._id,           // staff scanned
        qrId: qrCode.id,
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
        qrId: qrCode.id,
        status: type,
        reason: type,
        scannedBy: req.user.id,
        timeIn: null,
        date: today,
        timeOut: new Date(),
      });

      if (!newLog) {
        return next(
          new AppError("Error Transaction. Please try again", 404)
        );
      }

      return res.status(201).json({
        status: "success",
        message: "Transaction check-out.",
      });
    }
  }
);



// =========================================
// VISITOR / STUDENT → STAFF TRANSACTION SCAN
// =========================================
export const visitorScanQR = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {

    // =========================
    // 1. REQUEST VALIDATION
    // =========================
    const { qrString, mode, type } = req.body;

    // Required fields and enforced transaction type
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
    const user = await User.findOne({ _id: qrCode.userId });
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
    // Only Visitors or Students are allowed to use this scanner
    if (req.user?.role !== "Visitor" && req.user?.role !== "Student") {
      return next(new AppError("Invalid access", 500));
    }

    // =====================================================
    // 5. CHECK-IN TRANSACTION
    // =====================================================
    if (mode === "checkin" && type === "Transaction") {

      // Look for an existing transaction log today
      const existingLog = await Log.findOne({
        userId: req.user.id,       // visitor/student who scanned
        transId: user._id,          // staff being scanned
        qrId: qrCode.id,
        status: "Transaction",
        reason: type,
        date: { $gte: today },
        scannedBy: req.user._id,
        timeIn: null,
      });

      // If found, update the time-in
      if (existingLog) {
        existingLog.timeIn = new Date();
        await existingLog.save();
      }

      // Always create a new transaction log (per current logic)
      const newLog = await Log.create({
        userId: req.user._id,
        transId: user._id,
        qrId: qrCode.id,
        status: type,
        reason: type,
        scannedBy: req.user._id,
        timeOut: null,
        date: today,
        timeIn: new Date(),
      });

      if (!newLog) {
        return next(
          new AppError("Error Transaction. Please try again", 404)
        );
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

      // Look for an active transaction log today
      const existingLog = await Log.findOne({
        userId: req.user._id,       // visitor/student who scanned
        transId: user._id,          // staff being scanned
        qrId: qrCode.id,
        status: "Transaction",
        reason: type,
        date: { $gte: today },
        scannedBy: req.user._id,
        timeOut: null,
      });

      // If found, update the time-out
      if (existingLog) {
        existingLog.timeOut = new Date();
        await existingLog.save();
      }

      // Always create a new checkout transaction log (per current logic)
      const newLog = await Log.create({
        userId: req.user._id,
        transId: user._id,
        qrId: qrCode.id,
        status: type,
        reason: type,
        scannedBy: req.user._id,
        timeIn: null,
        date: today,
        timeOut: new Date(),
      });

      if (!newLog) {
        return next(
          new AppError("Error Transaction. Please try again", 404)
        );
      }

      return res.status(201).json({
        status: "success",
        message: "Transaction check-out.",
      });
    }
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

export const getLogs = async (req: AuthRequest, res: Response) => {
  try {
    const logs = await Log.find()
      .populate("userId", "firstName surname role photoURL")
      .populate("scannedBy", "firstName surname")
      .sort({ date: -1 });
    res.json(logs);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

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
