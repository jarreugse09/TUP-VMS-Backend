import dotenv from "dotenv";
import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

import Attendance from "../models/Attendance";
import User from "../models/User";
import VisitLog from "../models/VisitLog";

dotenv.config();

const MONGO = process.env.MONGODB_URI || "mongodb://localhost:27017/tup-vms";

const STAFF_SUBROLES = [
  "faculty",
  "security_head",
  "security_staff",
  "maintenance",
];

const TUP_SUBROLES = [
  "hr_head",
  "hr_staff",
  "non_academic",
  "dean",
  "department_head",
  "top_management",
  "superadmin",
];

const disconnectIfConnected = async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
};

async function run() {
  try {
    console.log("Connecting to MongoDB for V2 migration...");
    await mongoose.connect(MONGO);
    console.log(`Connected to MongoDB [${mongoose.connection.name}]`);

    const tupToStaffFilter = {
      role: "TUP",
      subRole: { $in: STAFF_SUBROLES },
    };
    const staffToTupFilter = {
      role: "Staff",
      subRole: { $in: TUP_SUBROLES },
    };

    const usersWronglyTup = await User.countDocuments(tupToStaffFilter);
    const usersWronglyStaff = await User.countDocuments(staffToTupFilter);

    await User.updateMany(tupToStaffFilter, { $set: { role: "Staff" } });
    await User.updateMany(staffToTupFilter, { $set: { role: "TUP" } });

    const consentBackfillFilter = { consentGiven: { $exists: false } };
    const usersConsentBackfilled =
      await User.countDocuments(consentBackfillFilter);
    await User.updateMany(consentBackfillFilter, {
      $set: { consentGiven: false, dataRetentionDays: 1825 },
    });

    await User.updateMany(
      {
        consentGiven: { $exists: true },
        dataRetentionDays: { $exists: false },
      },
      { $set: { dataRetentionDays: 1825 } },
    );

    const usersWithoutQr = await User.find({
      $or: [
        { qrCode: null },
        { qrCode: "" },
        { qrCode: { $exists: false } },
      ],
    }).select("_id");

    for (const user of usersWithoutQr) {
      await User.findByIdAndUpdate(user._id, { $set: { qrCode: uuidv4() } });
    }

    const updatedAtBackfillFilter = { updatedAt: { $exists: false } };
    const usersUpdatedAtBackfilled =
      await User.countDocuments(updatedAtBackfillFilter);
    await User.updateMany(updatedAtBackfillFilter, [
      { $set: { updatedAt: "$createdAt" } },
    ]);

    const attendanceWithoutStaffId = await Attendance.countDocuments({
      $or: [{ staffId: null }, { staffId: { $exists: false } }],
    });

    const visitIncompleteExitFilter = { incompleteExit: { $exists: false } };
    const visitLogsBackfilled =
      await VisitLog.countDocuments(visitIncompleteExitFilter);
    await VisitLog.updateMany(visitIncompleteExitFilter, {
      $set: { incompleteExit: false },
    });

    console.log("\nV2 migration summary");
    console.log(
      `Users role-fixed: ${usersWronglyTup + usersWronglyStaff} (TUP→Staff: ${usersWronglyTup}, Staff→TUP: ${usersWronglyStaff})`,
    );
    console.log(`Users consentGiven backfilled: ${usersConsentBackfilled}`);
    console.log(`Users qrCode generated: ${usersWithoutQr.length}`);
    console.log(`Users updatedAt backfilled: ${usersUpdatedAtBackfilled}`);
    console.log(`VisitLog incompleteExit backfilled: ${visitLogsBackfilled}`);
    console.log(
      `Attendance records with missing staffId (anomaly report only): ${attendanceWithoutStaffId}`,
    );
  } catch (error) {
    console.error("V2 migration failed:", error);
    process.exitCode = 1;
  } finally {
    await disconnectIfConnected();
  }
}

void run();
