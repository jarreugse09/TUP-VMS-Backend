import { Request, Response } from "express";
import Log from "../models/Log";
import Activity from "../models/Activity";
import User from "../models/User";
import QRCode from "../models/QRCode";
import Attendance from "../models/Attendance";

interface AuthRequest extends Request {
  user?: any;
}

export const scanQR = async (req: AuthRequest, res: Response) => {
  const { qrString, mode } = req.body; // mode: 'checkin' or 'checkout'

  try {
    const qrCode = await QRCode.findOne({ qrString });
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
      .populate("userId", "firstName surname role")
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
