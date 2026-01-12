import mongoose from 'mongoose';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';

import User from '../models/User';
import QRCode from '../models/QRCode';
import Log from '../models/Log';
import Attendance from '../models/Attendance';
import Activity from '../models/Activity';
import { generateQRString } from '../utils/qrUtils';

dotenv.config();

const MONGO = process.env.MONGODB_URI || 'mongodb://localhost:27017/tup-vms';
const START = new Date(process.env.SEED_START || '2025-11-01T00:00:00.000Z');
const END = new Date(process.env.SEED_END || '2026-01-12T23:59:59.999Z');

const STUDENTS = Number(process.env.SEED_STUDENTS || 60);
const STAFFS = Number(process.env.SEED_STAFFS || 20);
const VISITORS = Number(process.env.SEED_VISITORS || 40);
const demoEmailDomain = 'demo.local';

function photoUrl(name: string) {
  return `https://placehold.co/100x100?text=${encodeURIComponent(name)}`;
}

function addDays(d: Date, days: number) {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function timeOnDate(date: Date, hour: number, minute = 0) {
  const d = new Date(date);
  d.setHours(hour, minute, 0, 0);
  return d;
}

async function run() {
  await mongoose.connect(MONGO);
  console.log('Connected to MongoDB');

  // cleanup previous demo artifacts
  console.log('Cleaning previous demo records...');
  await Log.deleteMany({ demo: true as any }).catch(() => {});
  await Attendance.deleteMany({ demo: true as any }).catch(() => {});
  await QRCode.deleteMany({ demo: true }).catch(() => {});
  await User.deleteMany({ email: { $regex: `@${demoEmailDomain}$` } });

  // ensure admin exists
  let admin = await User.findOne({ role: 'TUP' }).exec();
  let createdAdmin = false;
  if (!admin) {
    const pass = await bcrypt.hash('Admin123!', 10);
    admin = await User.create({
      firstName: 'Admin',
      surname: 'Seed',
      birthdate: new Date('1990-01-01'),
      role: 'TUP',
      photoURL: photoUrl('Admin'),
      email: `admin_seed@${demoEmailDomain}`,
      passwordHash: pass,
      status: 'Active',
      demo: true,
    } as any);
    createdAdmin = true;
    console.log('Created temporary admin:', admin.email);
  }

  const createdUsers: any[] = [];
  console.log('Creating Students...');
  for (let i = 1; i <= STUDENTS; i++) {
    const email = `Student_${i}@${demoEmailDomain}`;
    const pass = await bcrypt.hash('password123', 10);
    const name = `Student_${i}`;
    const u = await User.create({
      firstName: name,
      surname: 'Demo',
      birthdate: new Date('2005-01-01'),
      role: 'Student',
      photoURL: photoUrl(name),
      email,
      passwordHash: pass,
      status: 'Active',
      createdAt: new Date(),
      demo: true,
    } as any);
    createdUsers.push(u);
  }

  console.log('Creating Staffs...');
  for (let i = 1; i <= STAFFS; i++) {
    const email = `Staff_${i}@${demoEmailDomain}`;
    const pass = await bcrypt.hash('password123', 10);
    const name = `Staff_${i}`;
    const u = await User.create({
      firstName: name,
      surname: 'Demo',
      birthdate: new Date('1990-01-01'),
      role: 'Staff',
      photoURL: photoUrl(name),
      email,
      passwordHash: pass,
      status: 'Active',
      createdAt: new Date(),
      demo: true,
    } as any);
    createdUsers.push(u);
  }

  console.log('Creating Visitors...');
  for (let i = 1; i <= VISITORS; i++) {
    const email = `Visitor_${i}@${demoEmailDomain}`;
    const pass = await bcrypt.hash('password123', 10);
    const name = `Visitor_${i}`;
    const u = await User.create({
      firstName: name,
      surname: 'Demo',
      birthdate: new Date('1985-01-01'),
      role: 'Visitor',
      photoURL: photoUrl(name),
      email,
      passwordHash: pass,
      status: 'Active',
      createdAt: new Date(),
      demo: true,
    } as any);
    createdUsers.push(u);
  }

  // create QR codes
  console.log('Creating QRCodes...');
  const qrDocs: Record<string, any> = {};
  const usedQRs = new Set<string>();
  for (const u of createdUsers) {
    let qrString = generateQRString(u.role);
    while (usedQRs.has(qrString)) qrString = generateQRString(u.role);
    usedQRs.add(qrString);
    const qr = await QRCode.create({ userId: u._id, qrString, isActive: true, demo: true });
    qrDocs[u._id.toString()] = qr;
  }

  // iterate dates and create logs/attendance/activities
  console.log('Seeding logs, attendance, activities from', START.toISOString(), 'to', END.toISOString());
  let date = new Date(START);
  let totalLogs = 0;
  let totalAtt = 0;
  let totalActs = 0;

  const students = createdUsers.filter((u) => u.role === 'Student');
  const staffs = createdUsers.filter((u) => u.role === 'Staff');
  const visitors = createdUsers.filter((u) => u.role === 'Visitor');

  while (date <= END) {
    const day = date.getDay(); // 0 sunday, 6 saturday

    // STAFF attendance + logs on weekdays
    if (day !== 0 && day !== 6) {
      for (const s of staffs) {
        const timeIn = timeOnDate(date, 8, randInt(0, 30));
        const timeOut = timeOnDate(date, 17, randInt(0, 60));
        await Attendance.create({
          staffId: s._id,
          date,
          timeIn,
          timeOut,
          scannedBy: admin!._id,
          demo: true,
        } as any);
        totalAtt++;

        await Log.create({
          userId: s._id,
          qrId: qrDocs[s._id.toString()]._id,
          date,
          timeIn,
          timeOut,
          status: 'Checked Out',
          scannedBy: admin!._id,
          demo: true,
        } as any);
        totalLogs++;
      }
    }

    // STUDENT logs: weekdays, most students attend
    if (day !== 0 && day !== 6) {
      for (const st of students) {
        if (Math.random() < 0.8) {
          const inT = timeOnDate(date, 8, randInt(0, 45));
          const outT = Math.random() < 0.9 ? timeOnDate(date, 15 + randInt(0, 2), randInt(0, 59)) : null;
          await Log.create({
            userId: st._id,
            qrId: qrDocs[st._id.toString()]._id,
            date,
            timeIn: inT,
            timeOut: outT,
            status: outT ? 'Checked Out' : 'In TUP',
            scannedBy: admin!._id,
            demo: true,
          } as any);
          totalLogs++;
        }
      }
    }

    // VISITOR logs: random, few per day
    const visitorsToday = randInt(0, 3);
    for (let i = 0; i < visitorsToday; i++) {
      const v = visitors[randInt(0, visitors.length - 1)];
      const inT = timeOnDate(date, randInt(8, 16), randInt(0, 59));
      const outT = Math.random() < 0.9 ? addDays(inT, 0) : null; // same day checkout most
      await Log.create({
        userId: v._id,
        qrId: qrDocs[v._id.toString()]._id,
        date,
        timeIn: inT,
        timeOut: outT,
        status: outT ? 'Checked Out' : 'In TUP',
        scannedBy: admin!._id,
        demo: true,
      } as any);
      totalLogs++;
    }

    // Random activities between users
    const activitiesToday = randInt(0, 5);
    for (let a = 0; a < activitiesToday; a++) {
      const from = createdUsers[randInt(0, createdUsers.length - 1)];
      let to = createdUsers[randInt(0, createdUsers.length - 1)];
      if (to._id.toString() === from._id.toString()) continue;
      const activityType = ['Delivery', 'Meeting', 'Assistance'][randInt(0,2)];
      const fromQR = qrDocs[from._id.toString()]?.qrString || '';
      await Activity.create({
        fromUserId: from._id,
        toUserId: to._id,
        fromQR,
        toQR: qrDocs[to._id.toString()]?.qrString || '',
        activityType,
        demo: true,
        date,
      } as any);
      totalActs++;
    }

    date = addDays(date, 1);
  }

  console.log(`Created ${createdUsers.length} users, ${totalAtt} attendance records, ${totalLogs} logs, ${totalActs} activities`);
  if (createdAdmin) console.log('Created temporary admin account for scanning:', admin!.email);
  console.log('Seeding complete.');
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});