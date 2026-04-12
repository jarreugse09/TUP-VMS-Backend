import express, { Request, Response } from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import { createServer } from "http";
import cron from "node-cron";
import fs from "fs";
import path from "path";

import analyticsRoute from './routes/analytics';
import attendanceRoutes from './routes/attendance';
import actionLogRoutes from "./routes/actionLogs";
import authRoutes from "./routes/auth";
import userRoutes from "./routes/users";
import alertRoutes from "./routes/alerts";
import chatRoutes from "./routes/chat";
import workScheduleRoutes from "./routes/workSchedules";
import specialScheduleRoutes from "./routes/specialSchedules";
import scanRoutes from "./routes/scan";
import collegeRoutes from "./routes/colleges";
import departmentRoutes from "./routes/departments";
import transactionRoutes from "./routes/transactions";
import transactionLogRoutes from "./routes/transactionLogs";
import backupRoutes from "./routes/backup";
import csvUploadRoutes from "./routes/csvUpload";
import reportRoutes from "./routes/reports";
import photoRequestRoutes from "./routes/photoRequests";
import archiveRoutes from "./routes/archive";
import visitLogRoutes from "./routes/visitLogs";
import { setupWebSocket } from "./websocket";
import { computeDailyAttendance } from "./utils/attendanceComputer";
import { scheduleEndOfDayCheckout } from "./utils/cronJobs";
import { authenticateToken } from "./middlewares/auth";

dotenv.config();

const isProduction = process.env.NODE_ENV === "production";

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error("FATAL: JWT_SECRET is missing or too short (min 32 chars).");
  process.exit(1);
}

if (!process.env.MONGODB_URI) {
  console.error("FATAL: MONGODB_URI is missing.");
  process.exit(1);
}

if (isProduction && !process.env.FRONTEND_URL) {
  console.error("FATAL: FRONTEND_URL is required in production.");
  process.exit(1);
}

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 5000;

// === 1️⃣ Trust proxy for Render ===
app.set("trust proxy", 1);

// === 2️⃣ CORS configuration ===
const configuredOrigins = (process.env.FRONTEND_URL || "")
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);

const allowedOrigins = Array.from(
  new Set([
    ...configuredOrigins,
    ...(!isProduction ? ["http://localhost:5173", "http://localhost:5174"] : []),
  ]),
);

const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    if (!origin) {
      callback(null, true);
      return;
    }

    const normalizedOrigin = origin.replace(/\/$/, "");
    if (allowedOrigins.includes(normalizedOrigin)) {
      callback(null, true);
      return;
    }

    callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions)); // handle preflight for all routes

// === 3️⃣ Body parsers ===
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// === 5️⃣ Health check route ===
app.get("/", (req: Request, res: Response) => {
  res.json({ status: "ok", message: "TUP VMS Backend is running 🚀" });
});

app.get(
  "/api/photo/:filename",
  authenticateToken,
  (req: Request, res: Response) => {
    const safeName = path.basename(req.params.filename);
    const candidatePaths = [
      path.join(__dirname, "../uploads", safeName),
      path.join(__dirname, "../uploads/profile-requests", safeName),
      path.join(__dirname, "../uploads/photo-requests", safeName),
    ];
    const filePath = candidatePaths.find((candidate) => fs.existsSync(candidate));

    if (!filePath) {
      res.status(404).json({ error: "Photo not found." });
      return;
    }

    res.sendFile(filePath, (err) => {
      if (err && !res.headersSent) {
        res.status(404).json({ error: "Photo not found." });
      }
    });
  },
);

// REMOVED FIX-018-D: /uploads is now served via authenticated /api/photo/:filename

// === 6️⃣ Connect MongoDB ===
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err: Error) => console.error("MongoDB connection error:", err));

// === 7️⃣ Mount routes ===
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/action-logs", actionLogRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/analytics", analyticsRoute);
app.use("/api/alerts", alertRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/work-schedules", workScheduleRoutes);
app.use("/api/special-schedules", specialScheduleRoutes);
app.use("/api/scan", scanRoutes);
app.use("/api/colleges", collegeRoutes);
app.use("/api/departments", departmentRoutes);
app.use("/api/transactions", transactionRoutes);
app.use("/api/transaction-logs", transactionLogRoutes);
app.use("/api/backup", backupRoutes);
app.use("/api/csv-upload", csvUploadRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/photo-requests", photoRequestRoutes);
app.use("/api/visit-logs", visitLogRoutes);
app.use("/api/admin/archive", archiveRoutes);
// REMOVED FIX-014: generic logs route retired

// === 8️⃣ Attendance Computation Cron Job ===
// Run daily at 6:00 PM Asia/Manila to compute attendance for the current day.
// timezone option is REQUIRED — without it node-cron uses the server's local tz (UTC on Render).
cron.schedule("0 18 * * *", async () => {
  console.log("[Cron] Running daily attendance computation (Asia/Manila 18:00)...");
  try {
    const today = new Date(); // getManilaTime() not needed here — cron already fired at 18:00 PHT
    await computeDailyAttendance(today);
    console.log("[Cron] Attendance computation completed");
  } catch (error) {
    console.error("[Cron] Attendance computation failed:", error);
  }
}, { timezone: "Asia/Manila" });

// Start 23:00 missing-exit cron
scheduleEndOfDayCheckout();

// === 9️⃣ Setup WebSocket ===
setupWebSocket(server);

// === 9️⃣ Start server ===
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket server ready`);
});
