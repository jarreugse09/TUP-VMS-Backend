import { Request, Response } from "express";
import { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, HeadingLevel } from "docx";
import archiver from "archiver";
import mongoose from "mongoose";
import Attendance from "../models/Attendance";
import VisitLog from "../models/VisitLog";
import User from "../models/User";
import { logAction } from "../utils/actionLogger";

interface AuthRequest extends Request {
  user?: any;
}

// Helper: format date PHT
const fmtDate = (d: Date | null | undefined): string =>
  d ? new Date(d).toLocaleDateString("en-PH", { timeZone: "Asia/Manila" }) : "-";

const fmtTime = (d: Date | null | undefined): string =>
  d ? new Date(d).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit" }) : "-";

// Helper: build a simple DOCX table
const buildDocxTable = (headers: string[], rows: string[][]): Table => {
  return new Table({
    rows: [
      new TableRow({
        children: headers.map(h =>
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })] })
        ),
      }),
      ...rows.map(row =>
        new TableRow({ children: row.map(cell => new TableCell({ children: [new Paragraph(cell)] })) })
      ),
    ],
  });
};

const buildDtrDocumentBuffer = async (
  title: string,
  periodLabel: string,
  headers: string[],
  rows: string[][],
): Promise<Buffer> => {
  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        new Paragraph({
          children: [new TextRun({ text: title, bold: true, size: 32 })],
          heading: HeadingLevel.HEADING_1,
        }),
        new Paragraph({ text: `Generated: ${new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" })}` }),
        new Paragraph({ text: `Period: ${periodLabel}` }),
        new Paragraph({ text: "" }),
        buildDocxTable(headers, rows),
      ],
    }],
  });

  return Packer.toBuffer(doc);
};

// ─── SINGLE-USER DTR ──────────────────────────────────────────────────────────
export const generateDTR = async (req: AuthRequest, res: Response) => {
  try {
    const { from, to, userId, collegeId, departmentId } = req.query;

    const query: any = { deletedAt: null, };

    if (from || to) {
      query.date = {};
      if (from) query.date.$gte = new Date(from as string);
      if (to) {
        const toDate = new Date(to as string);
        toDate.setHours(23, 59, 59, 999);
        query.date.$lte = toDate;
      }
    }

    if (userId) {
      query.staffId = new mongoose.Types.ObjectId(userId as string);
    }

    // RBAC silo enforcement for DTR query
    const subRole = req.user.subRole?.toLowerCase();

    if (subRole === "dean") {
      query.collegeId = req.user.collegeId;
    } else if (subRole === "department_head") {
      query.departmentId = req.user.departmentId;
    } else if (collegeId) {
      query.collegeId = new mongoose.Types.ObjectId(collegeId as string);
    } else if (departmentId) {
      query.departmentId = new mongoose.Types.ObjectId(departmentId as string);
    }

    // Faculty/staff can only generate their own DTR
    if (!["superadmin", "hr_head", "hr_staff", "dean", "department_head"].includes(subRole)) {
      query.staffId = req.user.id || req.user._id;
    }

    const attendances = await Attendance.find(query)
      .populate("staffId", "firstName surname email role subRole designation")
      .sort({ date: 1 })
      .lean();

    if (!attendances.length) {
      return res.status(404).json({ message: "No attendance records found for the given criteria." });
    }

    const tableRows = attendances.map((record: any) => {
      const u = record.staffId || {};
      return [
        fmtDate(record.date),
        u ? `${u.firstName} ${u.surname}` : "Unknown",
        fmtTime(record.timeIn),
        fmtTime(record.timeOut),
        record.status || "-",
        record.notes || "-",
      ];
    });

    const buffer = await buildDtrDocumentBuffer(
      "Daily Time Record (DTR)",
      `${from || "All"} to ${to || "All"}`,
      ["Date", "Name", "Time In", "Time Out", "Status", "Notes"],
      tableRows,
    );
    await logAction(req, "DTR_REPORT_GENERATED", "Attendance", null, `${attendances.length} records`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", 'attachment; filename="DTR_Report.docx"');
    return res.status(200).send(buffer);
  } catch (err: any) {
    console.error("DTR generation error:", err);
    return res.status(500).json({ message: "Failed to generate DTR", error: err.message });
  }
};

// ─── BULK DTR (zip of individual DTR files) ───────────────────────────────────
export const generateBulkDTR = async (req: AuthRequest, res: Response) => {
  try {
    const isPostRequest = req.method === "POST";
    const bodySource = req.body as { from?: string; to?: string; userIds?: string[] };
    const querySource = req.query as Record<string, string | undefined>;
    const from = isPostRequest ? bodySource.from : querySource.from;
    const to = isPostRequest ? bodySource.to : querySource.to;
    const rawUserIds = isPostRequest
      ? Array.isArray(bodySource.userIds)
        ? bodySource.userIds
        : []
      : typeof querySource.userIds === "string"
        ? querySource.userIds.split(",").map((id) => id.trim()).filter(Boolean)
        : [];
    const departmentId = isPostRequest ? undefined : querySource.departmentId;
    const collegeId = isPostRequest ? undefined : querySource.collegeId;
    const subRole = req.user.subRole?.toLowerCase();

    if (!from || !to) {
      return res.status(400).json({ message: "from and to are required." });
    }

    if (Number.isNaN(new Date(from).getTime()) || Number.isNaN(new Date(to).getTime())) {
      return res.status(400).json({ message: "from and to must be valid dates." });
    }

    // Build user filter
    const userFilter: any = { role: { $in: ["TUP", "Staff"] } };
    if (rawUserIds.length > 0) {
      const ids = rawUserIds.map((id) => new mongoose.Types.ObjectId(id));
      userFilter._id = { $in: ids };
    } else if (subRole === "dean") {
      return res.status(400).json({ message: "userIds must be a non-empty array." });
    } else if (subRole === "department_head") {
      return res.status(400).json({ message: "userIds must be a non-empty array." });
    } else if (departmentId) {
      userFilter.departmentId = new mongoose.Types.ObjectId(departmentId);
    } else if (collegeId) {
      userFilter.collegeId = new mongoose.Types.ObjectId(collegeId);
    } else if (!["superadmin", "hr_head", "hr_staff"].includes(subRole)) {
      return res.status(403).json({ message: "Forbidden: insufficient scope for bulk DTR" });
    }

    const users = await User.find(userFilter).lean();
    if (!users.length) return res.status(404).json({ message: "No users found for bulk DTR" });

    if (subRole === "dean") {
      const outOfScope = users.some((user) => user.collegeId?.toString() !== req.user.collegeId?.toString());
      if (outOfScope) {
        return res.status(403).json({ message: "One or more selected users are outside your college scope." });
      }
    }

    const dateFilter: any = {};
    dateFilter.$gte = new Date(from);
    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999);
    dateFilter.$lte = toDate;

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="bulk-dtr-${from}-${to}.zip"`);

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (err: Error) => res.status(500).json({ message: err.message }));
    archive.pipe(res);

    for (const user of users) {
      const query: any = { deletedAt: null,  staffId: user._id };
      if (Object.keys(dateFilter).length) query.date = dateFilter;
      const records = await Attendance.find(query).sort({ date: 1 }).lean();

      const tableRows = records.map((r: any) => [
        fmtDate(r.date), fmtTime(r.timeIn), fmtTime(r.timeOut), r.status || "-", r.notes || "-",
      ]);
      const buffer = await buildDtrDocumentBuffer(
        `DTR - ${user.firstName} ${user.surname}`,
        `${from} to ${to}`,
        ["Date", "Time In", "Time Out", "Status", "Notes"],
        tableRows,
      );
      archive.append(Buffer.from(buffer), {
        name: `DTR-${user.surname}-${user.firstName}-${from}-${to}.docx`,
      });
    }

    await logAction(req, "BULK_DTR_EXPORT", "Attendance", null, `${users.length} users exported from ${from} to ${to}`);
    await archive.finalize();
  } catch (err: any) {
    console.error("Bulk DTR error:", err);
    if (!res.headersSent) return res.status(500).json({ message: "Failed to generate bulk DTR" });
  }
};

// ─── DEPARTMENT ATTENDANCE REPORT ─────────────────────────────────────────────
export const generateDepartmentReport = async (req: AuthRequest, res: Response) => {
  try {
    const { from, to, departmentId } = req.query;
    const subRole = req.user.subRole?.toLowerCase();

    let deptFilter: any = {};
    if (subRole === "department_head") {
      deptFilter = { department: req.user.department };
    } else if (departmentId) {
      deptFilter = { department: new mongoose.Types.ObjectId(departmentId as string) };
    } else {
      return res.status(400).json({ message: "departmentId required" });
    }

    const users = await User.find({ role: { $in: ["TUP", "Staff"] }, ...deptFilter }).lean();
    const dateFilter: any = {};
    if (from) dateFilter.$gte = new Date(from as string);
    if (to) { const t = new Date(to as string); t.setHours(23, 59, 59, 999); dateFilter.$lte = t; }

    const query: any = { deletedAt: null,  staffId: { $in: users.map(u => u._id) } };
    if (Object.keys(dateFilter).length) query.date = dateFilter;

    const records = await Attendance.find(query).populate("staffId", "firstName surname").sort({ date: 1 }).lean();
    const tableRows = records.map((r: any) => {
      const u = r.staffId as any;
      return [fmtDate(r.date), u ? `${u.firstName} ${u.surname}` : "-", r.status || "-", fmtTime(r.timeIn), fmtTime(r.timeOut)];
    });

    const doc = new Document({
      sections: [{
        properties: {},
        children: [
          new Paragraph({ children: [new TextRun({ text: "Department Attendance Report", bold: true, size: 32 })], heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ text: `Period: ${from || "All"} to ${to || "All"}` }),
          new Paragraph({ text: `Total Records: ${records.length}` }),
          new Paragraph({ text: "" }),
          buildDocxTable(["Date", "Employee", "Status", "Time In", "Time Out"], tableRows),
        ],
      }],
    });

    const buffer = await Packer.toBuffer(doc);
    await logAction(req, "DEPT_REPORT_GENERATED", "Attendance", null, `${records.length} records`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", 'attachment; filename="Department_Report.docx"');
    return res.status(200).send(buffer);
  } catch (err: any) {
    return res.status(500).json({ message: "Failed to generate department report", error: err.message });
  }
};

// ─── COLLEGE ATTENDANCE REPORT ────────────────────────────────────────────────
export const generateCollegeReport = async (req: AuthRequest, res: Response) => {
  try {
    const { from, to, collegeId } = req.query;
    const subRole = req.user.subRole?.toLowerCase();

    let collegeFilter: any = {};
    if (subRole === "dean") {
      collegeFilter = { college: req.user.college };
    } else if (collegeId) {
      collegeFilter = { college: new mongoose.Types.ObjectId(collegeId as string) };
    } else {
      return res.status(400).json({ message: "collegeId required" });
    }

    const users = await User.find({ role: { $in: ["TUP", "Staff"] }, ...collegeFilter }).lean();
    const dateFilter: any = {};
    if (from) dateFilter.$gte = new Date(from as string);
    if (to) { const t = new Date(to as string); t.setHours(23, 59, 59, 999); dateFilter.$lte = t; }

    const query: any = { deletedAt: null,  staffId: { $in: users.map(u => u._id) } };
    if (Object.keys(dateFilter).length) query.date = dateFilter;

    const records = await Attendance.find(query).populate("staffId", "firstName surname subRole").sort({ date: 1 }).lean();
    const tableRows = records.map((r: any) => {
      const u = r.staffId as any;
      return [fmtDate(r.date), u ? `${u.firstName} ${u.surname}` : "-", u?.subRole || "-", r.status || "-", fmtTime(r.timeIn), fmtTime(r.timeOut)];
    });

    const doc = new Document({
      sections: [{
        properties: {},
        children: [
          new Paragraph({ children: [new TextRun({ text: "College Attendance Report", bold: true, size: 32 })], heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ text: `Period: ${from || "All"} to ${to || "All"}` }),
          new Paragraph({ text: `Total Records: ${records.length}` }),
          new Paragraph({ text: "" }),
          buildDocxTable(["Date", "Employee", "Sub-Role", "Status", "Time In", "Time Out"], tableRows),
        ],
      }],
    });

    const buffer = await Packer.toBuffer(doc);
    await logAction(req, "COLLEGE_REPORT_GENERATED", "Attendance", null, `${records.length} records`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", 'attachment; filename="College_Report.docx"');
    return res.status(200).send(buffer);
  } catch (err: any) {
    return res.status(500).json({ message: "Failed to generate college report", error: err.message });
  }
};

// ─── ANOMALY REPORT (missing time-in/out for Staff) ──────────────────────────
export const generateAnomalyReport = async (req: AuthRequest, res: Response) => {
  try {
    const { from, to } = req.query;
    const dateFilter: any = {};
    if (from) dateFilter.$gte = new Date(from as string);
    if (to) { const t = new Date(to as string); t.setHours(23, 59, 59, 999); dateFilter.$lte = t; }

    const query: any = { deletedAt: null,  $or: [{ timeIn: null }, { timeOut: null }] };
    if (Object.keys(dateFilter).length) query.date = dateFilter;

    const records = await Attendance.find(query).populate("staffId", "firstName surname role subRole").sort({ date: 1 }).lean();
    const tableRows = records.map((r: any) => {
      const u = r.staffId as any;
      return [fmtDate(r.date), u ? `${u.firstName} ${u.surname}` : "-", u?.subRole || "-", r.timeIn ? "Present" : "Missing Time-In", r.timeOut ? "Present" : "Missing Time-Out"];
    });

    const doc = new Document({
      sections: [{
        properties: {},
        children: [
          new Paragraph({ children: [new TextRun({ text: "Attendance Anomaly Report", bold: true, size: 32 })], heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ text: `Period: ${from || "All"} to ${to || "All"}` }),
          new Paragraph({ text: `Total Anomalies: ${records.length}` }),
          new Paragraph({ text: "" }),
          buildDocxTable(["Date", "Employee", "Sub-Role", "Time-In Status", "Time-Out Status"], tableRows),
        ],
      }],
    });

    const buffer = await Packer.toBuffer(doc);
    await logAction(req, "ANOMALY_REPORT_GENERATED", "Attendance", null, `${records.length} anomalies`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", 'attachment; filename="Anomaly_Report.docx"');
    return res.status(200).send(buffer);
  } catch (err: any) {
    return res.status(500).json({ message: "Failed to generate anomaly report", error: err.message });
  }
};

// ─── VISIT ANOMALY REPORT (missing time-out for Visitors/Students) ────────────
export const generateVisitAnomalyReport = async (req: AuthRequest, res: Response) => {
  try {
    const { from, to } = req.query;
    const dateFilter: any = {};
    if (from) dateFilter.$gte = new Date(from as string);
    if (to) { const t = new Date(to as string); t.setHours(23, 59, 59, 999); dateFilter.$lte = t; }

    const query: any = { deletedAt: null,  incompleteExit: true };
    if (Object.keys(dateFilter).length) query.date = dateFilter;

    const records = await VisitLog.find(query).populate("visitorId", "firstName surname role").sort({ date: 1 }).lean();
    const tableRows = records.map((r: any) => {
      const u = r.visitorId as any;
      return [fmtDate(r.date), u ? `${u.firstName} ${u.surname}` : "-", u?.role || "-", fmtTime(r.timeIn), r.purpose || "-"];
    });

    const doc = new Document({
      sections: [{
        properties: {},
        children: [
          new Paragraph({ children: [new TextRun({ text: "Visit Log Anomaly Report (No Time-Out)", bold: true, size: 32 })], heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ text: `Period: ${from || "All"} to ${to || "All"}` }),
          new Paragraph({ text: `Total: ${records.length} visitors without proper exit` }),
          new Paragraph({ text: "" }),
          buildDocxTable(["Date", "Visitor/Student", "Role", "Time In", "Purpose"], tableRows),
        ],
      }],
    });

    const buffer = await Packer.toBuffer(doc);
    await logAction(req, "VISIT_ANOMALY_REPORT_GENERATED", "VisitLog", null, `${records.length} records`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", 'attachment; filename="Visit_Anomaly_Report.docx"');
    return res.status(200).send(buffer);
  } catch (err: any) {
    return res.status(500).json({ message: "Failed to generate visit anomaly report", error: err.message });
  }
};

// ─── SECURITY PERFORMANCE REPORT ──────────────────────────────────────────────
export const generateSecurityPerformanceReport = async (req: AuthRequest, res: Response) => {
  try {
    const { from, to } = req.query;
    const subRole = req.user.subRole?.toLowerCase();
    if (!["superadmin", "security_head"].includes(subRole)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const dateFilter: any = {};
    if (from) dateFilter.$gte = new Date(from as string);
    if (to) { const t = new Date(to as string); t.setHours(23, 59, 59, 999); dateFilter.$lte = t; }

    const securityUsers = await User.find({ subRole: { $in: ["security_staff", "security_head"] } }).lean();
    const securityIds = securityUsers.map(u => u._id);

    const query: any = { deletedAt: null,  staffId: { $in: securityIds } };
    if (Object.keys(dateFilter).length) query.date = dateFilter;

    const records = await Attendance.find(query).populate("staffId", "firstName surname subRole").sort({ date: 1 }).lean();
    const tableRows = records.map((r: any) => {
      const u = r.staffId as any;
      return [fmtDate(r.date), u ? `${u.firstName} ${u.surname}` : "-", u?.subRole || "-", r.status || "-", fmtTime(r.timeIn), fmtTime(r.timeOut)];
    });

    const doc = new Document({
      sections: [{
        properties: {},
        children: [
          new Paragraph({ children: [new TextRun({ text: "Security Personnel Performance Report", bold: true, size: 32 })], heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ text: `Period: ${from || "All"} to ${to || "All"}` }),
          new Paragraph({ text: `Total Records: ${records.length}` }),
          new Paragraph({ text: "" }),
          buildDocxTable(["Date", "Officer", "Sub-Role", "Status", "Time In", "Time Out"], tableRows),
        ],
      }],
    });

    const buffer = await Packer.toBuffer(doc);
    await logAction(req, "SECURITY_PERF_REPORT_GENERATED", "Attendance", null, `${records.length} records`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", 'attachment; filename="Security_Performance_Report.docx"');
    return res.status(200).send(buffer);
  } catch (err: any) {
    return res.status(500).json({ message: "Failed to generate security performance report", error: err.message });
  }
};

// ─── EXECUTIVE SUMMARY REPORT ─────────────────────────────────────────────────
export const generateExecutiveReport = async (req: AuthRequest, res: Response) => {
  try {
    const { from, to } = req.query;
    const subRole = req.user.subRole?.toLowerCase();
    if (!["superadmin", "hr_head", "top_management"].includes(subRole)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const dateFilter: any = {};
    if (from) dateFilter.$gte = new Date(from as string);
    if (to) { const t = new Date(to as string); t.setHours(23, 59, 59, 999); dateFilter.$lte = t; }

    const query: any = { deletedAt: null, };
    if (Object.keys(dateFilter).length) query.date = dateFilter;

    const [allAttendance, allVisits, totalUsers] = await Promise.all([
      Attendance.find(query).lean(),
      VisitLog.find(Object.keys(dateFilter).length ? { date: dateFilter } : {}).lean(),
      User.countDocuments({ role: { $in: ["TUP", "Staff"] } }),
    ]);

    const present = allAttendance.filter(r => r.status === "present" || r.status === "late").length;
    const absent = allAttendance.filter(r => r.status === "absent").length;
    const wfh = allAttendance.filter(r => r.status === "wfh").length;
    const late = allAttendance.filter(r => r.status === "late").length;
    const anomalies = allAttendance.filter(r => !r.timeIn || !r.timeOut).length;
    const visitAnomalies = allVisits.filter((v: any) => v.incompleteExit).length;

    const summaryRows = [
      ["Total Workforce", String(totalUsers)],
      ["Attendance Records", String(allAttendance.length)],
      ["Present", String(present)],
      ["Absent", String(absent)],
      ["WFH", String(wfh)],
      ["Late", String(late)],
      ["Attendance Anomalies (missing in/out)", String(anomalies)],
      ["Total Visit Logs", String(allVisits.length)],
      ["Visit Anomalies (no time-out)", String(visitAnomalies)],
    ];

    const doc = new Document({
      sections: [{
        properties: {},
        children: [
          new Paragraph({ children: [new TextRun({ text: "Executive Summary Report — TUP VMS", bold: true, size: 36 })], heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ text: `Generated: ${new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" })}` }),
          new Paragraph({ text: `Period: ${from || "All"} to ${to || "All"}` }),
          new Paragraph({ text: "" }),
          new Paragraph({ children: [new TextRun({ text: "Attendance & Visit Summary", bold: true, size: 24 })], heading: HeadingLevel.HEADING_2 }),
          new Paragraph({ text: "" }),
          buildDocxTable(["Metric", "Value"], summaryRows),
        ],
      }],
    });

    const buffer = await Packer.toBuffer(doc);
    await logAction(req, "EXECUTIVE_REPORT_GENERATED", "Attendance", null, "Executive summary");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", 'attachment; filename="Executive_Summary_Report.docx"');
    return res.status(200).send(buffer);
  } catch (err: any) {
    return res.status(500).json({ message: "Failed to generate executive report", error: err.message });
  }
};
