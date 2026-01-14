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
const allowedOrigins = [
  process.env.FRONTEND_URL, // your main frontend URL
  "http://localhost:5173",   // local frontend dev URL
];

const corsOptions = {
  origin: (origin: string | undefined, callback: any) => {
    // allow requests with no origin (like Postman)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      return callback(new Error(`Not allowed by CORS: ${origin}`));
    }
  },
  credentials: true,
};

app.use(cors(corsOptions));

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
