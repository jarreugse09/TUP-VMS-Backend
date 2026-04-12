import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

import ActionLog from "../models/ActionLog";
import Alert from "../models/Alert";
import Attendance from "../models/Attendance";
import BackupLog from "../models/BackupLog";
import ChatMessage from "../models/ChatMessage";
import College from "../models/College";
import CsvUploadLog from "../models/CsvUploadLog";
import Department from "../models/Department";
import PhotoUpdateRequest from "../models/PhotoUpdateRequest";
import QRCode from "../models/QRCode";
import QRRequest from "../models/QRRequest";
import SpecialSchedule from "../models/SpecialSchedule";
import TransactionLog from "../models/TransactionLog";
import User, { IUser } from "../models/User";
import VisitLog from "../models/VisitLog";
import WorkSchedule from "../models/WorkSchedule";

dotenv.config();

const MONGO = process.env.MONGODB_URI || "mongodb://localhost:27017/tup-vms";
const PASSWORD = "TupVms@2025";
const CONSENT_DATE = new Date("2025-01-01T00:00:00+08:00");
const FORCE_FLAG = "--force";

type SeedUser = mongoose.HydratedDocument<IUser>;

type UserSeedInput = {
  name: string;
  email: string;
  role: "TUP" | "Staff" | "Student" | "Visitor";
  subRole?: string | null;
  birthdate?: Date;
  collegeId?: mongoose.Types.ObjectId | null;
  college?: string | null;
  departmentId?: mongoose.Types.ObjectId | null;
  department?: string | null;
  workScheduleId?: mongoose.Types.ObjectId | null;
  designation?: string;
  officeUnit?: string;
  staffType?: string;
  platesNumber?: string | null;
  isWFH?: boolean;
};

type AttendanceSeed = {
  staffId: mongoose.Types.ObjectId;
  date: Date;
  timeIn: Date | null;
  timeOut: Date | null;
  breakStart?: Date | null;
  breakEnd?: Date | null;
  totalHours?: number;
  scannedBy?: mongoose.Types.ObjectId | null;
  platesNumber?: string | null;
  status:
    | "present"
    | "late"
    | "absent"
    | "wfh"
    | "holiday"
    | "exempt"
    | "present (unscheduled)";
  goOutEntries?: Array<{
    goOutTime: Date;
    goInTime: Date | null;
    reason: string;
    approvedBy: mongoose.Types.ObjectId | null;
  }>;
  notes?: string | null;
  collegeId?: mongoose.Types.ObjectId | null;
  departmentId?: mongoose.Types.ObjectId | null;
  deletedAt?: Date | null;
};

type VisitSeed = {
  visitorId: mongoose.Types.ObjectId;
  hostId?: mongoose.Types.ObjectId | null;
  date: Date;
  timeIn: Date;
  timeOut: Date | null;
  purpose: string;
  scannedBy: mongoose.Types.ObjectId;
  platesNumber?: string | null;
  collegeId?: mongoose.Types.ObjectId | null;
  departmentId?: mongoose.Types.ObjectId | null;
  incompleteExit: boolean;
};

type TransactionSeed = {
  clientId: mongoose.Types.ObjectId;
  staffId: mongoose.Types.ObjectId;
  transactionStart: Date;
  transactionEnd: Date;
  transactionType: string;
  scannedBy: string;
  notes?: string | null;
  collegeId?: mongoose.Types.ObjectId | null;
  departmentId?: mongoose.Types.ObjectId | null;
};

const splitName = (name: string) => {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0], surname: "User" };
  }

  return {
    firstName: parts.slice(0, -1).join(" "),
    surname: parts[parts.length - 1],
  };
};

const photoURLFor = (name: string) =>
  `https://placehold.co/400x400?text=${encodeURIComponent(name)}`;

const disconnectIfConnected = async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
};

const getDateDaysAgo = (daysAgo: number, hour = 8, minute = 0) => {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hour, minute, 0, 0);
  return date;
};

const withTime = (date: Date, hour: number, minute = 0) => {
  const copy = new Date(date);
  copy.setHours(hour, minute, 0, 0);
  return copy;
};

const isWeekend = (date: Date) => {
  const day = date.getDay();
  return day === 0 || day === 6;
};

const getWeightedAttendanceStatus = (): AttendanceSeed["status"] => {
  const roll = Math.random();

  if (roll < 0.7) return "present";
  if (roll < 0.8) return "late";
  if (roll < 0.9) return "absent";
  if (roll < 0.95) return "wfh";
  return "exempt";
};

const randomFrom = <T>(items: T[]): T =>
  items[Math.floor(Math.random() * items.length)];

const randomInteger = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const buildUser = async (
  input: UserSeedInput,
  passwordHash: string,
): Promise<SeedUser> => {
  const { firstName, surname } = splitName(input.name);

  const user = new User({
    firstName,
    surname,
    birthdate: input.birthdate || new Date("1990-01-01"),
    role: input.role,
    subRole: input.subRole ?? undefined,
    collegeId: input.collegeId ?? null,
    college: input.college ?? undefined,
    departmentId: input.departmentId ?? null,
    department: input.department ?? undefined,
    workScheduleId: input.workScheduleId ?? null,
    designation: input.designation,
    officeUnit: input.officeUnit,
    staffType: input.staffType,
    qrCode: uuidv4(),
    platesNumber: input.platesNumber ?? null,
    isWFH: input.isWFH ?? false,
    photoURL: photoURLFor(input.name),
    email: input.email,
    passwordHash,
    status: "Active",
    consentGiven: true,
    consentDate: CONSENT_DATE,
    dataRetentionDays: 1825,
  });

  await user.save();
  return user;
};

const printCredentialsTable = (
  users: Array<{ label: string; email: string; role: string; subRole: string | null }>,
) => {
  console.log("\nSeeded test credentials");
  console.table(
    users.map((user) => ({
      Account: user.label,
      Email: user.email,
      Role: user.role,
      SubRole: user.subRole || "-",
      Password: PASSWORD,
    })),
  );
};

const addQrDocuments = async (users: SeedUser[]) => {
  await QRCode.insertMany(
    users.map((user) => ({
      userId: user._id,
      qrString: user.qrCode,
      isActive: true,
    })),
  );
};

async function main() {
  try {
    await mongoose.connect(MONGO);
    console.log(`Connected to MongoDB [${mongoose.connection.name}]`);

    const existingCount = await User.countDocuments();
    if (existingCount > 0 && !process.argv.includes(FORCE_FLAG)) {
      console.log("⚠ Database already seeded.");
      console.log("  Run with --force to drop and reseed.");
      await disconnectIfConnected();
      return;
    }

    if (process.argv.includes(FORCE_FLAG)) {
      console.log("🔄 --force flag detected. Dropping all collections...");
      await Promise.all([
        User.deleteMany({}),
        Attendance.deleteMany({}),
        VisitLog.deleteMany({}),
        TransactionLog.deleteMany({}),
        Alert.deleteMany({}),
        ChatMessage.deleteMany({}),
        QRRequest.deleteMany({}),
        PhotoUpdateRequest.deleteMany({}),
        ActionLog.deleteMany({}),
        CsvUploadLog.deleteMany({}),
        BackupLog.deleteMany({}),
        College.deleteMany({}),
        Department.deleteMany({}),
        WorkSchedule.deleteMany({}),
        SpecialSchedule.deleteMany({}),
        QRCode.deleteMany({}),
      ]);
      console.log("✅ Collections cleared.");
    }

    const passwordHash = await bcrypt.hash(PASSWORD, 12);

    const colleges = await College.insertMany([
      { name: "College of Industrial Technology", code: "CIT" },
      { name: "College of Industrial Education", code: "CIE" },
      { name: "College of Engineering", code: "COE" },
      { name: "College of Science", code: "COS" },
      { name: "College of Architecture and Fine Arts", code: "CAFA" },
      { name: "College of Liberal Arts", code: "CLA" },
    ]);
    const [citCollege, cieCollege, coeCollege, cosCollege, cafaCollege, claCollege] =
      colleges;

    const departments = await Department.insertMany([
      {
        name: "Information Technology",
        code: "IT",
        collegeId: citCollege._id,
      },
      {
        name: "Electronics Technology",
        code: "ET",
        collegeId: citCollege._id,
      },
      {
        name: "Industrial Education",
        code: "IED",
        collegeId: cieCollege._id,
      },
      {
        name: "Industrial Arts",
        code: "IA",
        collegeId: cieCollege._id,
      },
      {
        name: "Mechanical Engineering",
        code: "ME",
        collegeId: coeCollege._id,
      },
      {
        name: "Civil Engineering",
        code: "CE",
        collegeId: coeCollege._id,
      },
      {
        name: "Biology",
        code: "BIO",
        collegeId: cosCollege._id,
      },
      {
        name: "Mathematics",
        code: "MATH",
        collegeId: cosCollege._id,
      },
      {
        name: "Architecture",
        code: "ARCH",
        collegeId: cafaCollege._id,
      },
      {
        name: "Fine Arts",
        code: "FA",
        collegeId: cafaCollege._id,
      },
      {
        name: "Communication",
        code: "COMM",
        collegeId: claCollege._id,
      },
      {
        name: "Psychology",
        code: "PSY",
        collegeId: claCollege._id,
      },
    ]);

    const [
      itDept,
      etDept,
      iedDept,
      iaDept,
      meDept,
      ceDept,
      bioDept,
      mathDept,
      archDept,
      fineArtsDept,
      commDept,
      psyDept,
    ] = departments;

    const [standardSchedule, flexSchedule, securitySchedule] =
      await WorkSchedule.insertMany([
        {
          name: "Standard 8-5",
          days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
          timeIn: "08:00",
          timeOut: "17:00",
          graceMinutes: 15,
          isFlexible: false,
          createdBy: null,
        },
        {
          name: "Flexible",
          days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
          timeIn: "07:00",
          timeOut: "18:00",
          graceMinutes: 30,
          isFlexible: true,
          createdBy: null,
        },
        {
          name: "Security Rotating",
          days: [
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday",
          ],
          timeIn: "07:00",
          timeOut: "15:00",
          graceMinutes: 10,
          isFlexible: false,
          createdBy: null,
        },
      ]);

    const superadmin = await buildUser(
      {
        name: "System Administrator",
        email: "superadmin@tup.edu.ph",
        role: "TUP",
        subRole: "superadmin",
        workScheduleId: standardSchedule._id,
        designation: "System Administrator",
        officeUnit: "Central Administration",
      },
      passwordHash,
    );

    const topManagement = await buildUser(
      {
        name: "University President",
        email: "top_management@tup.edu.ph",
        role: "TUP",
        subRole: "top_management",
        workScheduleId: flexSchedule._id,
        designation: "University President",
        officeUnit: "Executive Office",
      },
      passwordHash,
    );

    const dean = await buildUser(
      {
        name: "Dean CIT",
        email: "dean@tup.edu.ph",
        role: "TUP",
        subRole: "dean",
        collegeId: citCollege._id,
        college: citCollege.name,
        workScheduleId: standardSchedule._id,
        designation: "College Dean",
        officeUnit: citCollege.name,
      },
      passwordHash,
    );

    const deptHead = await buildUser(
      {
        name: "Department Head IT",
        email: "depthead@tup.edu.ph",
        role: "TUP",
        subRole: "department_head",
        collegeId: citCollege._id,
        college: citCollege.name,
        departmentId: itDept._id,
        department: itDept.name,
        workScheduleId: standardSchedule._id,
        designation: "Department Head",
        officeUnit: itDept.name,
      },
      passwordHash,
    );

    const nonAcademic = await buildUser(
      {
        name: "Non-Academic Staff",
        email: "nonacademic@tup.edu.ph",
        role: "TUP",
        subRole: "non_academic",
        workScheduleId: standardSchedule._id,
        designation: "Administrative Staff",
        officeUnit: "Registrar",
      },
      passwordHash,
    );

    const hrHead = await buildUser(
      {
        name: "HR Head",
        email: "hr_head@tup.edu.ph",
        role: "TUP",
        subRole: "hr_head",
        workScheduleId: standardSchedule._id,
        designation: "HR Head",
        officeUnit: "Human Resources",
        staffType: "Admin",
      },
      passwordHash,
    );

    const hrStaff = await buildUser(
      {
        name: "HR Staff",
        email: "hr_staff@tup.edu.ph",
        role: "TUP",
        subRole: "hr_staff",
        workScheduleId: standardSchedule._id,
        designation: "HR Staff",
        officeUnit: "Human Resources",
        staffType: "Admin",
      },
      passwordHash,
    );

    const faculty = await buildUser(
      {
        name: "Faculty Member",
        email: "faculty@tup.edu.ph",
        role: "Staff",
        subRole: "faculty",
        collegeId: citCollege._id,
        college: citCollege.name,
        departmentId: itDept._id,
        department: itDept.name,
        workScheduleId: standardSchedule._id,
        designation: "Faculty Member",
        officeUnit: itDept.name,
      },
      passwordHash,
    );

    const securityHead = await buildUser(
      {
        name: "Security Head",
        email: "security_head@tup.edu.ph",
        role: "Staff",
        subRole: "security_head",
        workScheduleId: securitySchedule._id,
        designation: "Security Head",
        officeUnit: "Civil Security Office",
        staffType: "Security",
      },
      passwordHash,
    );

    const securityStaff = await buildUser(
      {
        name: "Security Staff",
        email: "security_staff@tup.edu.ph",
        role: "Staff",
        subRole: "security_staff",
        workScheduleId: securitySchedule._id,
        designation: "Security Staff",
        officeUnit: "Civil Security Office",
        staffType: "Security",
      },
      passwordHash,
    );

    const maintenance = await buildUser(
      {
        name: "Maintenance Staff",
        email: "maintenance@tup.edu.ph",
        role: "Staff",
        subRole: "maintenance",
        workScheduleId: standardSchedule._id,
        designation: "Maintenance Staff",
        officeUnit: "Facilities Maintenance",
        platesNumber: "TUP-MAINT-101",
      },
      passwordHash,
    );

    const student = await buildUser(
      {
        name: "Juan dela Cruz",
        email: "student@tup.edu.ph",
        role: "Student",
        subRole: null,
      },
      passwordHash,
    );

    const student2 = await buildUser(
      {
        name: "Maria Santos",
        email: "student2@tup.edu.ph",
        role: "Student",
        subRole: null,
      },
      passwordHash,
    );

    const student3 = await buildUser(
      {
        name: "Pedro Reyes",
        email: "student3@tup.edu.ph",
        role: "Student",
        subRole: null,
      },
      passwordHash,
    );

    const visitor = await buildUser(
      {
        name: "Jose Rizal",
        email: "visitor@tup.edu.ph",
        role: "Visitor",
        subRole: null,
      },
      passwordHash,
    );

    const visitor2 = await buildUser(
      {
        name: "Andres Bonifacio",
        email: "visitor2@tup.edu.ph",
        role: "Visitor",
        subRole: null,
      },
      passwordHash,
    );

    const seededUsers = [
      superadmin,
      topManagement,
      dean,
      deptHead,
      nonAcademic,
      hrHead,
      hrStaff,
      faculty,
      securityHead,
      securityStaff,
      maintenance,
      student,
      student2,
      student3,
      visitor,
      visitor2,
    ];

    await addQrDocuments(seededUsers);

    await WorkSchedule.updateMany({}, { $set: { createdBy: superadmin._id } });
    await College.findByIdAndUpdate(citCollege._id, { $set: { deanId: dean._id } });
    await Department.findByIdAndUpdate(itDept._id, { $set: { headId: deptHead._id } });

    const staffUsers = [
      superadmin,
      topManagement,
      dean,
      deptHead,
      nonAcademic,
      hrHead,
      hrStaff,
      faculty,
      securityHead,
      securityStaff,
      maintenance,
    ];

    const attendanceRecords: AttendanceSeed[] = [];

    for (const staffUser of staffUsers) {
      for (let daysAgo = 1; daysAgo <= 30; daysAgo += 1) {
        const baseDate = getDateDaysAgo(daysAgo);
        if (isWeekend(baseDate)) {
          continue;
        }

        const status = getWeightedAttendanceStatus();
        const record: AttendanceSeed = {
          staffId: staffUser._id,
          date: baseDate,
          timeIn: null,
          timeOut: null,
          scannedBy: securityStaff._id,
          platesNumber:
            staffUser.subRole === "maintenance" ? "TUP-MAINT-101" : null,
          status,
          notes: null,
          collegeId: staffUser.collegeId || null,
          departmentId: staffUser.departmentId || null,
          deletedAt: null,
        };

        if (status === "present") {
          record.timeIn = withTime(baseDate, 8, randomInteger(0, 10));
          record.timeOut = withTime(baseDate, 17, 0);
          record.totalHours = 9;
        } else if (status === "late") {
          record.timeIn = withTime(baseDate, 8, 30);
          record.timeOut = withTime(baseDate, 17, 0);
          record.totalHours = 8.5;
        } else if (status === "wfh") {
          record.notes = "WFH schedule";
        } else if (status === "exempt") {
          record.notes = "Leave approved";
        }

        attendanceRecords.push(record);
      }
    }

    attendanceRecords.push({
      staffId: faculty._id,
      date: getDateDaysAgo(3),
      timeIn: withTime(getDateDaysAgo(3), 8, 5),
      timeOut: null,
      scannedBy: securityStaff._id,
      status: "present",
      notes: "Anomaly: no timeout",
      collegeId: faculty.collegeId || null,
      departmentId: faculty.departmentId || null,
      deletedAt: null,
    });

    attendanceRecords.push({
      staffId: securityStaff._id,
      date: getDateDaysAgo(5),
      timeIn: withTime(getDateDaysAgo(5), 7, 0),
      timeOut: null,
      scannedBy: securityHead._id,
      status: "present",
      goOutEntries: [
        {
          goOutTime: withTime(getDateDaysAgo(5), 11, 15),
          goInTime: null,
          reason: "Patrol outside perimeter",
          approvedBy: securityHead._id,
        },
      ],
      notes: "Anomaly: go out without go in",
      collegeId: securityStaff.collegeId || null,
      departmentId: securityStaff.departmentId || null,
      deletedAt: null,
    });

    attendanceRecords.push({
      staffId: maintenance._id,
      date: getDateDaysAgo(7),
      timeIn: null,
      timeOut: withTime(getDateDaysAgo(7), 17, 0),
      scannedBy: securityHead._id,
      platesNumber: "TUP-MAINT-101",
      status: "present",
      notes: "Anomaly: timeout without timein",
      collegeId: maintenance.collegeId || null,
      departmentId: maintenance.departmentId || null,
      deletedAt: null,
    });

    await Attendance.insertMany(attendanceRecords);

    const visitors = [student, student2, student3, visitor, visitor2];
    const visitHosts = [faculty, nonAcademic, hrStaff, deptHead, dean];
    const securityScanners = [securityStaff, securityHead];
    const visitLogRecords: VisitSeed[] = [];

    for (let index = 0; index < 15; index += 1) {
      const daysAgo = 14 - (index % 14);
      const date = getDateDaysAgo(daysAgo, 9 + (index % 4), 10);
      const host = randomFrom(visitHosts);
      visitLogRecords.push({
        visitorId: visitors[index % visitors.length]._id,
        hostId: host._id,
        date,
        timeIn: withTime(date, 9 + (index % 3), 15),
        timeOut: withTime(date, 11 + (index % 5), 30),
        purpose: "Campus visit",
        scannedBy: randomFrom(securityScanners)._id,
        platesNumber: index % 2 === 0 ? `VISIT-${100 + index}` : null,
        collegeId: host.collegeId || null,
        departmentId: host.departmentId || null,
        incompleteExit: false,
      });
    }

    for (let index = 0; index < 3; index += 1) {
      const date = getDateDaysAgo(10 - index, 10, 0);
      const host = randomFrom(visitHosts);
      visitLogRecords.push({
        visitorId: visitors[(index + 2) % visitors.length]._id,
        hostId: host._id,
        date,
        timeIn: withTime(date, 10, 20),
        timeOut: null,
        purpose: "Incomplete exit test",
        scannedBy: randomFrom(securityScanners)._id,
        platesNumber: null,
        collegeId: host.collegeId || null,
        departmentId: host.departmentId || null,
        incompleteExit: true,
      });
    }

    for (let index = 0; index < 2; index += 1) {
      const date = getDateDaysAgo(0, 13 + index, 0);
      const host = randomFrom(visitHosts);
      visitLogRecords.push({
        visitorId: visitors[(index + 3) % visitors.length]._id,
        hostId: host._id,
        date,
        timeIn: withTime(date, 13 + index, 5),
        timeOut: null,
        purpose: "Currently inside campus",
        scannedBy: randomFrom(securityScanners)._id,
        platesNumber: null,
        collegeId: host.collegeId || null,
        departmentId: host.departmentId || null,
        incompleteExit: false,
      });
    }

    await VisitLog.insertMany(visitLogRecords);

    const transactionClients = [student, student2, student3, visitor, visitor2];
    const transactionProviders = [faculty, securityHead];
    const transactionTypes = [
      "document_request",
      "id_replacement",
      "clearance",
    ];
    const transactionRecords: TransactionSeed[] = [];

    for (let index = 0; index < 30; index += 1) {
      const provider = transactionProviders[index % transactionProviders.length];
      const client = transactionClients[index % transactionClients.length];
      const date = getDateDaysAgo((index % 14) + 1, 8 + (index % 7), 0);
      const start = withTime(date, 8 + (index % 7), randomInteger(0, 20));
      const end = new Date(
        start.getTime() + randomInteger(30, 120) * 60 * 1000,
      );

      transactionRecords.push({
        clientId: client._id,
        staffId: provider._id,
        transactionStart: start,
        transactionEnd: end,
        transactionType: transactionTypes[index % transactionTypes.length],
        scannedBy: "self",
        notes: "Demo transaction record",
        collegeId: provider.collegeId || null,
        departmentId: provider.departmentId || null,
      });
    }

    await TransactionLog.insertMany(transactionRecords);

    await Alert.insertMany([
      {
        type: "weapon",
        title: "Potential weapon detected",
        cameraSource: "GATE-1",
        detectionLabel: "weapon",
        confidence: 0.97,
        severity: "critical",
        audience: ["security_head", "superadmin"],
        message: "Potential weapon detected near Gate 1",
        globalIncidentStatus: "new",
        collegeId: citCollege._id,
        createdAt: new Date(Date.now() - 60 * 60 * 1000),
        updatedAt: new Date(Date.now() - 60 * 60 * 1000),
      },
      {
        type: "intrusion",
        title: "Unauthorized entry detected",
        cameraSource: "LIB-2",
        detectionLabel: "intrusion",
        confidence: 0.88,
        severity: "high",
        audience: ["security_head", "superadmin"],
        message: "Unauthorized entry detected in Library",
        globalIncidentStatus: "acknowledged",
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      },
      {
        type: "loitering",
        title: "Loitering near parking area",
        cameraSource: "PARK-A",
        detectionLabel: "loitering",
        confidence: 0.72,
        severity: "medium",
        audience: ["security_staff", "security_head"],
        message: "Loitering detected near parking area",
        globalIncidentStatus: "resolved",
        createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        updatedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
      {
        type: "unattended",
        title: "Unattended bag detected",
        cameraSource: "HALL-3",
        detectionLabel: "unattended_bag",
        confidence: 0.91,
        severity: "high",
        audience: ["security_staff", "security_head"],
        message: "Unattended bag detected in hallway",
        globalIncidentStatus: "new",
        createdAt: new Date(Date.now() - 30 * 60 * 1000),
        updatedAt: new Date(Date.now() - 30 * 60 * 1000),
      },
      {
        type: "other",
        title: "Suspicious behavior",
        cameraSource: "CANTEEN-1",
        detectionLabel: "suspicious_behavior",
        confidence: 0.66,
        severity: "medium",
        audience: ["security_head", "superadmin"],
        message: "Suspicious behavior at canteen",
        globalIncidentStatus: "new",
        createdAt: new Date(Date.now() - 15 * 60 * 1000),
        updatedAt: new Date(Date.now() - 15 * 60 * 1000),
      },
    ]);

    const rootMessage = await ChatMessage.create({
      groupId: "security_general",
      senderId: securityHead._id,
      senderName: "Security Head",
      senderRole: "Staff",
      message:
        "All personnel report to stations. Suspicious activity at Gate 1.",
      isSystemMessage: false,
      mentions: [securityStaff._id],
      readBy: [securityHead._id, securityStaff._id],
      threadId: null,
      replyTo: null,
      createdAt: new Date(Date.now() - 60 * 60 * 1000),
      updatedAt: new Date(Date.now() - 60 * 60 * 1000),
    });

    await ChatMessage.create({
      groupId: "security_general",
      senderId: securityStaff._id,
      senderName: "Security Staff",
      senderRole: "Staff",
      message: "Understood. On my way to Gate 1.",
      isSystemMessage: false,
      replyTo: rootMessage._id,
      threadId: null,
      mentions: [],
      readBy: [securityStaff._id],
      createdAt: new Date(Date.now() - 58 * 60 * 1000),
      updatedAt: new Date(Date.now() - 58 * 60 * 1000),
    });

    await ChatMessage.create({
      groupId: "security_general",
      senderId: superadmin._id,
      senderName: "System Administrator",
      senderRole: "TUP",
      message: "Situation update requested.",
      isSystemMessage: false,
      threadId: rootMessage._id,
      replyTo: null,
      mentions: [securityHead._id],
      readBy: [superadmin._id],
      createdAt: new Date(Date.now() - 57 * 60 * 1000),
      updatedAt: new Date(Date.now() - 57 * 60 * 1000),
    });

    await ChatMessage.create({
      groupId: "security_general",
      senderId: null,
      senderName: "Hawkeye System",
      senderRole: "System",
      message:
        "HAWKEYE ALERT: weapon detected at zone GATE-1. Potential weapon detected near Gate 1",
      isSystemMessage: true,
      threadId: null,
      replyTo: null,
      mentions: [securityHead._id, superadmin._id],
      readBy: [],
      createdAt: new Date(Date.now() - 60 * 60 * 1000),
      updatedAt: new Date(Date.now() - 60 * 60 * 1000),
    });

    const extraMessages = [
      {
        senderId: securityHead._id,
        senderName: "Security Head",
        senderRole: "Staff" as const,
        message: "North gate is secure.",
        createdAt: new Date(Date.now() - 50 * 60 * 1000),
      },
      {
        senderId: securityStaff._id,
        senderName: "Security Staff",
        senderRole: "Staff" as const,
        message: "Copy. CCTV team notified.",
        createdAt: new Date(Date.now() - 48 * 60 * 1000),
      },
      {
        senderId: superadmin._id,
        senderName: "System Administrator",
        senderRole: "TUP" as const,
        message: "Please file an incident note once resolved.",
        createdAt: new Date(Date.now() - 46 * 60 * 1000),
      },
      {
        senderId: securityHead._id,
        senderName: "Security Head",
        senderRole: "Staff" as const,
        message: "Acknowledged. Dispatch team is on standby.",
        createdAt: new Date(Date.now() - 44 * 60 * 1000),
      },
      {
        senderId: securityStaff._id,
        senderName: "Security Staff",
        senderRole: "Staff" as const,
        message: "Crowd is calm. Continuing observation.",
        createdAt: new Date(Date.now() - 42 * 60 * 1000),
      },
      {
        senderId: securityHead._id,
        senderName: "Security Head",
        senderRole: "Staff" as const,
        message: "Keep this channel updated every 10 minutes.",
        createdAt: new Date(Date.now() - 40 * 60 * 1000),
      },
    ];

    await ChatMessage.insertMany(
      extraMessages.map((message) => ({
        groupId: "security_general",
        senderId: message.senderId,
        senderName: message.senderName,
        senderRole: message.senderRole,
        message: message.message,
        isSystemMessage: false,
        mentions: [],
        readBy: [message.senderId],
        threadId: null,
        replyTo: null,
        createdAt: message.createdAt,
        updatedAt: message.createdAt,
      })),
    );

    const qrRequests = await QRRequest.insertMany([
      {
        userId: student._id,
        requestType: "QR",
        reason: "My QR code is damaged and unreadable",
        status: "pending",
        createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
      {
        userId: faculty._id,
        requestType: "QR",
        reason: "Lost phone with QR code saved",
        status: "approved",
        approvedBy: hrHead._id,
        reviewedBy: hrHead._id,
        reviewedAt: new Date(Date.now() - 12 * 60 * 60 * 1000),
        createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      },
      {
        userId: visitor._id,
        requestType: "QR",
        reason: "Expired QR code from previous visit",
        status: "rejected",
        reviewedBy: securityHead._id,
        reviewedAt: new Date(Date.now() - 6 * 60 * 60 * 1000),
        createdAt: new Date(Date.now() - 27 * 60 * 60 * 1000),
      },
    ]);

    const photoRequests = await PhotoUpdateRequest.insertMany([
      {
        requesterId: student._id,
        newPhotoUrl: "https://placehold.co/400x400?text=New+Photo",
        status: "pending",
        createdAt: new Date(Date.now() - 60 * 60 * 1000),
        updatedAt: new Date(Date.now() - 60 * 60 * 1000),
      },
      {
        requesterId: visitor._id,
        newPhotoUrl: "https://placehold.co/400x400?text=Updated+Photo",
        status: "rejected",
        reviewedBy: securityHead._id,
        reviewedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        rejectionReason: "Photo does not show a clear face",
        createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      },
    ]);

    const actionTargets = [
      { action: "LOGIN", targetModel: "User", targetId: superadmin._id },
      { action: "LOGOUT", targetModel: "User", targetId: hrHead._id },
      { action: "USER_CREATED", targetModel: "User", targetId: faculty._id },
      { action: "USER_UPDATED", targetModel: "User", targetId: deptHead._id },
      {
        action: "ATTENDANCE_UPDATED",
        targetModel: "Attendance",
        targetId: new mongoose.Types.ObjectId(),
      },
      {
        action: "QR_REQUEST_APPROVED",
        targetModel: "QRRequest",
        targetId: qrRequests[1]._id,
      },
      {
        action: "QR_REQUEST_REJECTED",
        targetModel: "QRRequest",
        targetId: qrRequests[2]._id,
      },
      {
        action: "PHOTO_REQUEST_SUBMITTED",
        targetModel: "PhotoUpdateRequest",
        targetId: photoRequests[0]._id,
      },
      {
        action: "PHOTO_REQUEST_APPROVED",
        targetModel: "PhotoUpdateRequest",
        targetId: photoRequests[1]._id,
      },
      {
        action: "BACKUP_DOWNLOADED",
        targetModel: "BackupLog",
        targetId: new mongoose.Types.ObjectId(),
      },
      {
        action: "CSV_UPLOAD_ATTENDANCE",
        targetModel: "CsvUploadLog",
        targetId: new mongoose.Types.ObjectId(),
      },
      { action: "USER_SUSPENDED", targetModel: "User", targetId: visitor2._id },
      { action: "USER_BLOCKED", targetModel: "User", targetId: visitor._id },
      {
        action: "USER_UNBLOCKED",
        targetModel: "User",
        targetId: securityStaff._id,
      },
      {
        action: "CONSENT_RECORDED",
        targetModel: "User",
        targetId: student._id,
      },
      { action: "LOGIN", targetModel: "User", targetId: securityHead._id },
      { action: "LOGOUT", targetModel: "User", targetId: securityStaff._id },
      { action: "USER_UPDATED", targetModel: "User", targetId: maintenance._id },
      {
        action: "ATTENDANCE_UPDATED",
        targetModel: "Attendance",
        targetId: new mongoose.Types.ObjectId(),
      },
      {
        action: "CONSENT_RECORDED",
        targetModel: "User",
        targetId: visitor._id,
      },
    ];

    await ActionLog.insertMany(
      actionTargets.map((item, index) => ({
        performedBy: [
          superadmin._id,
          hrHead._id,
          hrStaff._id,
          securityHead._id,
          securityStaff._id,
          faculty._id,
        ][index % 6],
        action: item.action,
        targetModel: item.targetModel,
        targetId: item.targetId,
        details: `${item.action} recorded during demo seed`,
        severity: index % 7 === 0 ? "warning" : "info",
        ipAddress: "127.0.0.1",
        userAgent: "Seed Script/1.0",
        timestamp: new Date(Date.now() - index * 36 * 60 * 60 * 1000),
      })),
    );

    await CsvUploadLog.create({
      uploadedBy: hrStaff._id,
      uploadType: "attendance",
      fileName: "attendance-jan-2025.csv",
      recordsInserted: 145,
      recordsFailed: 3,
      uploadErrors: [
        { row: 12, message: "Invalid date format" },
        { row: 45, message: "User not found" },
        { row: 78, message: "Invalid status value" },
      ],
    });

    await BackupLog.create({
      createdBy: superadmin._id,
      backupType: "manual",
      fileName: "vms-backup-1736000000000.json.gz",
      sizeBytes: 2048576,
      status: "success",
    });

    await SpecialSchedule.insertMany([
      {
        type: "holiday",
        scope: "all",
        targetId: null,
        date: new Date("2025-06-12T00:00:00+08:00"),
        reason: "Independence Day",
        approvedBy: superadmin._id,
      },
      {
        type: "wfh",
        scope: "individual",
        targetId: faculty._id,
        date: new Date(Date.now() + 24 * 60 * 60 * 1000),
        reason: "Work from home approved",
        approvedBy: hrHead._id,
      },
    ]);

    const counts = {
      users: await User.countDocuments(),
      attendance: await Attendance.countDocuments(),
      visitLogs: await VisitLog.countDocuments(),
      transactions: await TransactionLog.countDocuments(),
      alerts: await Alert.countDocuments(),
      chatMessages: await ChatMessage.countDocuments(),
      qrRequests: await QRRequest.countDocuments(),
      photoRequests: await PhotoUpdateRequest.countDocuments(),
      actionLogs: await ActionLog.countDocuments(),
    };

    console.log("\nSeed summary");
    console.table(
      Object.entries(counts).map(([collection, count]) => ({
        Collection: collection,
        Count: count,
      })),
    );

    printCredentialsTable([
      {
        label: "Superadmin",
        email: superadmin.email,
        role: superadmin.role,
        subRole: superadmin.subRole || null,
      },
      {
        label: "Top Management",
        email: topManagement.email,
        role: topManagement.role,
        subRole: topManagement.subRole || null,
      },
      {
        label: "Dean",
        email: dean.email,
        role: dean.role,
        subRole: dean.subRole || null,
      },
      {
        label: "Department Head",
        email: deptHead.email,
        role: deptHead.role,
        subRole: deptHead.subRole || null,
      },
      {
        label: "Non-Academic",
        email: nonAcademic.email,
        role: nonAcademic.role,
        subRole: nonAcademic.subRole || null,
      },
      {
        label: "HR Head",
        email: hrHead.email,
        role: hrHead.role,
        subRole: hrHead.subRole || null,
      },
      {
        label: "HR Staff",
        email: hrStaff.email,
        role: hrStaff.role,
        subRole: hrStaff.subRole || null,
      },
      {
        label: "Faculty",
        email: faculty.email,
        role: faculty.role,
        subRole: faculty.subRole || null,
      },
      {
        label: "Security Head",
        email: securityHead.email,
        role: securityHead.role,
        subRole: securityHead.subRole || null,
      },
      {
        label: "Security Staff",
        email: securityStaff.email,
        role: securityStaff.role,
        subRole: securityStaff.subRole || null,
      },
      {
        label: "Maintenance",
        email: maintenance.email,
        role: maintenance.role,
        subRole: maintenance.subRole || null,
      },
      {
        label: "Student",
        email: student.email,
        role: student.role,
        subRole: student.subRole || null,
      },
      {
        label: "Visitor",
        email: visitor.email,
        role: visitor.role,
        subRole: visitor.subRole || null,
      },
    ]);

    console.log(
      "Additional demo accounts seeded: student2@tup.edu.ph, student3@tup.edu.ph, visitor2@tup.edu.ph",
    );
    console.log("✅ Seed complete.");
  } catch (error) {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  } finally {
    await disconnectIfConnected();
  }
}

void main();
