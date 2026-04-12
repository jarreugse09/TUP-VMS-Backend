import { Request, Response, NextFunction } from "express";
import { parse } from "csv-parse/sync";
import User from "../models/User";
import Attendance from "../models/Attendance";
import CsvUploadLog from "../models/CsvUploadLog";
import VisitLog from "../models/VisitLog";
import TransactionLog from "../models/TransactionLog";
import { logAction } from "../utils/actionLogger";

interface AuthRequest extends Request {
  user?: any;
}

export const uploadAttendanceCSV = async (req: AuthRequest, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ message: "No CSV file provided" });
  }

  const fileContent = req.file.buffer.toString("utf-8");
  let records: any[];
  try {
    records = parse(fileContent, { columns: true, skip_empty_lines: true });
  } catch (err: any) {
    return res.status(400).json({ message: "Invalid CSV format", error: err.message });
  }

  const errors: { row: number; message: string }[] = [];
  let inserted = 0;
  let failed = 0;

  for (let i = 0; i < records.length; i++) {
    const rowNum = i + 2; // +1 for 0-index, +1 for header
    const r = records[i];
    try {
      if (!r.userId || !r.date || !r.status) {
        errors.push({ row: rowNum, message: "Missing required fields (userId, date, status)" });
        failed++;
        continue;
      }

      const user = await User.findById(r.userId).lean();
      if (!user) {
        errors.push({ row: rowNum, message: `User not found: ${r.userId}` });
        failed++;
        continue;
      }

      const parsedDate = new Date(r.date);
      if (isNaN(parsedDate.getTime())) {
        errors.push({ row: rowNum, message: `Invalid date format: ${r.date}` });
        failed++;
        continue;
      }

      const validStatuses = ["present", "late", "absent", "wfh", "holiday", "exempt", "present (unscheduled)"];
      if (!validStatuses.includes(r.status)) {
        errors.push({ row: rowNum, message: `Invalid status: ${r.status}` });
        failed++;
        continue;
      }

      await Attendance.findOneAndUpdate(
        { staffId: r.userId, date: parsedDate, deletedAt: null },
        {
          $set: {
            timeIn: r.timeIn ? new Date(r.timeIn) : null,
            timeOut: r.timeOut ? new Date(r.timeOut) : null,
            status: r.status,
            notes: r.notes || null,
            collegeId: user.collegeId,
            departmentId: user.departmentId,
          }
        },
        { upsert: true, new: true }
      );
      inserted++;
    } catch (err: any) {
      errors.push({ row: rowNum, message: err.message });
      failed++;
    }
  }

  const log = await CsvUploadLog.create({
    uploadedBy: req.user.id || req.user._id,
    uploadType: "attendance",
    fileName: req.file.originalname,
    recordsInserted: inserted,
    recordsFailed: failed,
    uploadErrors: errors
  });

  await logAction(req, "CSV_UPLOAD_ATTENDANCE", "CsvUploadLog", log._id, `Uploaded ${inserted} attendance records, ${failed} failed`);

  return res.status(200).json({ recordsInserted: inserted, recordsFailed: failed, errors });
};

export const uploadTransactionCSV = async (req: AuthRequest, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ message: "No CSV file provided" });
  }

  const fileContent = req.file.buffer.toString("utf-8");
  let records: any[];
  try {
    records = parse(fileContent, { columns: true, skip_empty_lines: true });
  } catch (err: any) {
    return res.status(400).json({ message: "Invalid CSV format", error: err.message });
  }

  const errors: { row: number; message: string }[] = [];
  let inserted = 0;
  let failed = 0;

  for (let i = 0; i < records.length; i++) {
    const rowNum = i + 2;
    const r = records[i];
    try {
      if (!r.clientId || !r.staffId || !r.transactionType || !r.transactionStart) {
        errors.push({ row: rowNum, message: "Missing required fields (clientId, staffId, transactionType, transactionStart)" });
        failed++;
        continue;
      }

      const start = new Date(r.transactionStart);
      if (isNaN(start.getTime())) {
        errors.push({ row: rowNum, message: `Invalid transactionStart format: ${r.transactionStart}` });
        failed++;
        continue;
      }

      const client = await User.findById(r.clientId).lean();
      const staff = await User.findById(r.staffId).lean();
      if (!client || !staff) {
        errors.push({ row: rowNum, message: "Client or Staff not found" });
        failed++;
        continue;
      }

      await TransactionLog.create({
        clientId: r.clientId,
        staffId: r.staffId,
        transactionType: r.transactionType,
        transactionStart: start,
        transactionEnd: r.transactionEnd ? new Date(r.transactionEnd) : null,
        notes: r.notes || null,
        scannedBy: "csv_upload",
        collegeId: staff.collegeId,
        departmentId: staff.departmentId,
      });
      inserted++;
    } catch (err: any) {
      errors.push({ row: rowNum, message: err.message });
      failed++;
    }
  }

  const uploadLog = await CsvUploadLog.create({
    uploadedBy: req.user.id || req.user._id,
    uploadType: "transaction",
    fileName: req.file.originalname,
    recordsInserted: inserted,
    recordsFailed: failed,
    uploadErrors: errors
  });

  await logAction(req, "CSV_UPLOAD_TRANSACTION", "CsvUploadLog", uploadLog._id, `Uploaded ${inserted} transaction records, ${failed} failed`);

  return res.status(200).json({ recordsInserted: inserted, recordsFailed: failed, errors });
};

export const uploadVisitLogCSV = async (req: AuthRequest, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ message: "No CSV file provided" });
  }

  const fileContent = req.file.buffer.toString("utf-8");
  let records: any[];
  try {
    records = parse(fileContent, { columns: true, skip_empty_lines: true });
  } catch (err: any) {
    return res.status(400).json({ message: "Invalid CSV format", error: err.message });
  }

  const errors: { row: number; message: string }[] = [];
  let inserted = 0;
  let failed = 0;

  for (let i = 0; i < records.length; i++) {
    const rowNum = i + 2;
    const r = records[i];
    try {
      if (!r.visitorId || !r.date || !r.timeIn || !r.purpose) {
        errors.push({ row: rowNum, message: "Missing required fields (visitorId, date, timeIn, purpose)" });
        failed++;
        continue;
      }

      const visitor = await User.findById(r.visitorId).lean();
      if (!visitor) {
        errors.push({ row: rowNum, message: `Visitor not found: ${r.visitorId}` });
        failed++;
        continue;
      }

      const parsedDate = new Date(r.date);
      const start = new Date(r.timeIn);
      if (isNaN(parsedDate.getTime()) || isNaN(start.getTime())) {
        errors.push({ row: rowNum, message: "Invalid date/timeIn format" });
        failed++;
        continue;
      }

      await VisitLog.create({
        visitorId: r.visitorId,
        date: parsedDate,
        timeIn: start,
        timeOut: r.timeOut ? new Date(r.timeOut) : null,
        purpose: r.purpose,
        platesNumber: r.platesNumber || null,
        scannedBy: req.user.id || req.user._id,
      });
      inserted++;
    } catch (err: any) {
      errors.push({ row: rowNum, message: err.message });
      failed++;
    }
  }

  const uploadLog = await CsvUploadLog.create({
    uploadedBy: req.user.id || req.user._id,
    uploadType: "visit_log",
    fileName: req.file.originalname,
    recordsInserted: inserted,
    recordsFailed: failed,
    uploadErrors: errors
  });

  await logAction(req, "CSV_UPLOAD_VISIT", "CsvUploadLog", uploadLog._id, `Uploaded ${inserted} visit log records, ${failed} failed`);

  return res.status(200).json({ recordsInserted: inserted, recordsFailed: failed, errors });
};

export const getAttendanceTemplate = (req: Request, res: Response) => {
  const header = "userId,date,timeIn,timeOut,status,notes\n";
  const example = "60e1c23f90b2c1b8480d1234,2023-10-01,2023-10-01T08:00:00Z,2023-10-01T17:00:00Z,present,Regular shift\n";
  
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="attendance-template.csv"');
  res.status(200).send(header + example);
};

export const getTransactionTemplate = (req: Request, res: Response) => {
  const header = "clientId,staffId,transactionType,transactionStart,transactionEnd,notes\n";
  const example = "60e1c23f90...,60e1c23f90...,Payment,2023-10-01T08:00:00Z,2023-10-01T08:15:00Z,Tuition fee\n";
  
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="transaction-template.csv"');
  res.status(200).send(header + example);
};

export const getVisitLogTemplate = (req: Request, res: Response) => {
  const header = "visitorId,date,timeIn,timeOut,purpose,platesNumber\n";
  const example = "60e1c23f90...,2023-10-01,2023-10-01T08:00:00Z,2023-10-01T12:00:00Z,Meeting,ABC-1234\n";
  
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="visit-log-template.csv"');
  res.status(200).send(header + example);
};

export const getUploadLogs = async (req: AuthRequest, res: Response) => {
  try {
    const logs = await CsvUploadLog.find()
      .populate("uploadedBy", "firstName surname email role subRole")
      .sort({ createdAt: -1 });
    res.json({ data: logs });
  } catch (error) {
    console.error("Get CSV upload logs error:", error);
    res.status(500).json({ message: "Server error" });
  }
};
