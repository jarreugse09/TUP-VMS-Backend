import express, { Request, Response } from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";

import analyticsRoute from './routes/analytics';
import attendanceRoutes from './routes/attendance';
import authRoutes from "./routes/auth";
import userRoutes from "./routes/users";
import logRoutes from "./routes/logs";

dotenv.config();

const app = express();
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
    "http://localhost:5173",
    "http://localhost:5174",
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
  methods: ["GET","POST","PUT","DELETE","PATCH","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"]
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions)); // handle preflight for all routes

// === 3️⃣ Body parsers ===
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// === 4️⃣ Static folder for uploads ===
app.use('/uploads', express.static('uploads'));

// === 5️⃣ Health check route ===
app.get("/", (req: Request, res: Response) => {
  res.json({ status: "ok", message: "TUP VMS Backend is running 🚀" });
});

// === 6️⃣ Connect MongoDB ===
mongoose
  .connect(process.env.MONGODB_URI!)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

// === 7️⃣ Mount routes ===
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/logs", logRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/analytics", analyticsRoute);

// === 8️⃣ Start server ===
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
