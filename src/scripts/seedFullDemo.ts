import mongoose from "mongoose";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";

import User from "../models/User";
import QRCode from "../models/QRCode";
import Log from "../models/Log";
import Attendance from "../models/Attendance";
import Activity from "../models/Activity";
import QRRequest from "../models/QRRequest";

import { generateQRString } from "../utils/qrUtils";

dotenv.config();

/* ================= CONFIG ================= */

const MONGO = process.env.MONGODB_URI || "mongodb://localhost:27017/tup-vms";

const START = new Date("2026-01-01");
const END = new Date("2026-04-30");

const TOTAL_USERS = 200; // 🔥 SMALL DATA FOR REAL LOGIN TESTING

const STUDENT_COUNT = Math.floor(TOTAL_USERS * 0.8);
const STAFF_COUNT = Math.floor(TOTAL_USERS * 0.15);
const VISITOR_COUNT = TOTAL_USERS - STUDENT_COUNT - STAFF_COUNT;

const STAFF_TYPES = ["Admin", "Guard", "Normal", "Registrar", "Teacher"];

const DOMAIN = "gmail.com";

// 🔥 reduced transactions for performance
const TRANSACTION_SCALE = 0.4; // 60% reduction in transactions

/* ================= HELPERS ================= */

const addDays = (d: Date, days: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
};

const rand = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const chance = (p: number) => Math.random() < p;

const time = (date: Date, h: number, m: number = 0) => {
  const d = new Date(date);
  d.setHours(h, m, 0, 0);
  return d;
};

const photo = (name: string) =>
  `https://placehold.co/100x100?text=${encodeURIComponent(name)}`;

/* ================= MAIN ================= */

async function run() {
  await mongoose.connect(MONGO);
  console.log("Connected DB");

  /* ================= CLEAN ================= */

  await Promise.all([
    User.deleteMany({}),
    QRCode.deleteMany({}),
    Log.deleteMany({}),
    Attendance.deleteMany({}),
    Activity.deleteMany({}),
    QRRequest.deleteMany({}),
  ]);

  /* ================= ADMIN ================= */

  const adminPass = await bcrypt.hash("technovisitor", 10);

  const admin = await User.create({
    firstName: "TUP",
    surname: "Admin",
    role: "TUP",
    email: "tup-vms@gmail.com",
    passwordHash: adminPass,
    birthdate: new Date("1990-01-01"),
    photoURL: photo("TUP"),
    status: "Active",
  });

  /* ================= USERS ================= */

  console.log("Creating users...");

  const users: any[] = [];

  const createUsers = async (
    role: "Student" | "Staff" | "Visitor",
    count: number
  ) => {
    const password = await bcrypt.hash(`${role.toLowerCase()}123!`, 10);

    for (let i = 1; i <= count; i++) {
      users.push({
        firstName: `${role}_${i}`,
        surname: "Demo",
        birthdate:
          role === "Student"
            ? new Date("2005-01-01")
            : new Date("1990-01-01"),
        role,
        staffType:
          role === "Staff"
            ? STAFF_TYPES[rand(0, STAFF_TYPES.length - 1)]
            : undefined,
        email: `${role.toLowerCase()}_${i}@${DOMAIN}`,
        passwordHash: password,
        photoURL: photo(`${role}_${i}`),
        status: "Active",
        mustCapturePhoto: false,
        createdAt: new Date(),
      });
    }
  };

  await createUsers("Student", STUDENT_COUNT);
  await createUsers("Staff", STAFF_COUNT);
  await createUsers("Visitor", VISITOR_COUNT);

  const insertedUsers = await User.insertMany(users);

  /* ================= QR ================= */

  console.log("Creating QR codes...");

  const qrDocs: any[] = [];
  const userQRMap: Record<string, any> = {};

  for (const u of insertedUsers) {
    qrDocs.push({
      userId: u._id,
      qrString: generateQRString(u.role),
      isActive: true,
    });
  }

  const insertedQRs = await QRCode.insertMany(qrDocs);

  insertedQRs.forEach((qr) => {
    userQRMap[qr.userId.toString()] = qr;
  });

  /* ================= QR REQUESTS ================= */

  console.log("Creating QR Requests...");

  const qrRequests: any[] = [];

  for (const u of insertedUsers) {
    if (chance(0.05)) {
      const type = chance(0.7) ? "QR" : "PROFILE_PHOTO";

      let status: "Pending" | "Approved" | "Rejected" = "Pending";
      const r = Math.random();

      if (r < 0.7) status = "Approved";
      else if (r < 0.9) status = "Pending";
      else status = "Rejected";

      const qrData = userQRMap[u._id.toString()];

      qrRequests.push({
        userId: u._id,
        requestType: type,
        oldQR: qrData?.qrString,
        reason: ["Lost ID", "Damaged QR", "Update Info"][rand(0, 2)],
        newQRString:
          type === "QR" && status === "Approved"
            ? generateQRString(u.role)
            : undefined,
        newQRImage: type === "QR" ? "https://placehold.co/300x300" : undefined,
        oldPhotoURL: type === "PROFILE_PHOTO" ? u.photoURL : undefined,
        newPhotoImage: type === "PROFILE_PHOTO" ? photo("NEW") : undefined,
        status,
        approvedBy: status === "Approved" ? admin._id : undefined,
      });
    }
  }

  await QRRequest.insertMany(qrRequests);

  /* ================= DATA ================= */

  console.log("Generating logs, attendance, transactions...");

  const logs: any[] = [];
  const attendance: any[] = [];
  const activities: any[] = [];

  let date = new Date(START);

  while (date <= END) {
    const day = date.getDay();
    const activeUsers: string[] = [];

    for (const u of insertedUsers) {
      const id = u._id.toString();
      const qr = userQRMap[id];

      if (!qr) continue;

      /* ===== WEEKDAY STAFF ===== */
      if (u.role === "Staff" && day !== 0 && day !== 6) {
        const tin = time(date, 8, rand(0, 30));
        const tout = time(date, 17, rand(0, 60));

        attendance.push({
          staffId: u._id,
          date,
          timeIn: tin,
          timeOut: tout,
          scannedBy: admin._id,
        });

        logs.push({
          userId: u._id,
          qrId: qr._id,
          date,
          timeIn: tin,
          timeOut: tout,
          status: "Checked Out",
          reason: "attendance",
          scannedBy: admin._id,
        });

        activeUsers.push(id);
      }

      /* ===== WEEKDAY STUDENTS / VISITORS ===== */
      if (
        (u.role === "Student" || u.role === "Visitor") &&
        day !== 0 &&
        day !== 6 &&
        chance(0.7)
      ) {
        const tin = time(date, rand(7, 9), rand(0, 59));
        const tout = chance(0.9)
          ? time(date, rand(15, 18), rand(0, 59))
          : null;

        logs.push({
          userId: u._id,
          qrId: qr._id,
          date,
          timeIn: tin,
          timeOut: tout,
          status: tout ? "Checked Out" : "In TUP",
          reason: "checkin",
          scannedBy: admin._id,
        });

        activeUsers.push(id);
      }

      /* ===== SATURDAY ===== */

      if (u.role === "Student" && day === 6 && chance(0.08)) {
        const tin = time(date, rand(8, 10), rand(0, 59));
        const tout = chance(0.8)
          ? time(date, rand(13, 17), rand(0, 59))
          : null;

        logs.push({
          userId: u._id,
          qrId: qr._id,
          date,
          timeIn: tin,
          timeOut: tout,
          status: tout ? "Checked Out" : "In TUP",
          reason: "weekend",
          scannedBy: admin._id,
        });

        activeUsers.push(id);
      }

      if (u.role === "Staff" && day === 6 && chance(0.5)) {
        const tin = time(date, rand(8, 9), rand(0, 59));
        const tout = time(date, rand(12, 16), rand(0, 59));

        attendance.push({
          staffId: u._id,
          date,
          timeIn: tin,
          timeOut: tout,
          scannedBy: admin._id,
        });

        logs.push({
          userId: u._id,
          qrId: qr._id,
          date,
          timeIn: tin,
          timeOut: tout,
          status: "Checked Out",
          reason: "weekend-attendance",
          scannedBy: admin._id,
        });

        activeUsers.push(id);
      }

      if (u.role === "Visitor" && day === 6 && chance(0.2)) {
        const tin = time(date, rand(9, 11), rand(0, 59));
        const tout = chance(0.8)
          ? time(date, rand(14, 17), rand(0, 59))
          : null;

        logs.push({
          userId: u._id,
          qrId: qr._id,
          date,
          timeIn: tin,
          timeOut: tout,
          status: tout ? "Checked Out" : "In TUP",
          reason: "visit",
          scannedBy: admin._id,
        });

        activeUsers.push(id);
      }

      /* ===== SUNDAY (STAFF ONLY) ===== */
      if (u.role === "Staff" && day === 0 && chance(0.05)) {
        const tin = time(date, 8, rand(0, 30));
        const tout = time(date, 12, rand(0, 59));

        attendance.push({
          staffId: u._id,
          date,
          timeIn: tin,
          timeOut: tout,
          scannedBy: admin._id,
        });

        logs.push({
          userId: u._id,
          qrId: qr._id,
          date,
          timeIn: tin,
          timeOut: tout,
          status: "Checked Out",
          reason: "sunday-duty",
          scannedBy: admin._id,
        });

        activeUsers.push(id);
      }
    }

    /* ===== TRANSACTIONS ===== */

    const transCount = Math.max(
      1,
      Math.floor(rand(1, 5) * TRANSACTION_SCALE)
    );

    for (let i = 0; i < transCount; i++) {
      if (activeUsers.length < 2) break;

      const from = activeUsers[rand(0, activeUsers.length - 1)];
      const to = activeUsers[rand(0, activeUsers.length - 1)];

      if (from === to) continue;

      const fromQR = userQRMap[from];
      const toQR = userQRMap[to];

      if (!fromQR || !toQR) continue;

      logs.push({
        userId: from,
        transId: to,
        qrId: toQR._id,
        date,
        timeIn: new Date(date),
        status: "Transaction",
        reason: "transaction",
        scannedBy: from,
      });

      activities.push({
        fromUserId: from,
        toUserId: to,
        fromQR: fromQR.qrString,
        toQR: toQR.qrString,
        activityType: ["Transaction", "Meeting", "Assistance"][rand(0, 2)],
        timestamp: new Date(date),
      });
    }

    date = addDays(date, 1);
  }

  /* ================= INSERT ================= */

  console.log("Inserting logs...");
  await Log.insertMany(logs, { ordered: false });

  console.log("Inserting attendance...");
  await Attendance.insertMany(attendance, { ordered: false });

  console.log("Inserting activities...");
  await Activity.insertMany(activities, { ordered: false });

  console.log("✅ SEED COMPLETE (LIGHTWEIGHT)");
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});