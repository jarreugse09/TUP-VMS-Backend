import mongoose, { Document, Schema } from "mongoose";

export interface IAttendance extends Document {
  _id: mongoose.Types.ObjectId;
  staffId: mongoose.Types.ObjectId;
  date: Date;
  timeIn?: Date | null;
  timeOut?: Date;
  totalHours?: number;
  scannedBy?: mongoose.Types.ObjectId | null;
  status?: "present" | "late" | "absent" | "wfh" | "holiday" | "exempt";
  notes?: string | null;
}

const AttendanceSchema: Schema = new Schema({
  staffId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  date: { type: Date, required: true },
  timeIn: { type: Date, default: null },
  timeOut: { type: Date, default: null },
  totalHours: { type: Number },
  scannedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  status: {
    type: String,
    enum: ["present", "late", "absent", "wfh", "holiday", "exempt"],
    default: "present",
  },
  notes: { type: String, default: null },
});

// Performance indexes
AttendanceSchema.index({ staffId: 1, date: -1 });
AttendanceSchema.index({ date: -1, status: 1 });

export default mongoose.model<IAttendance>("Attendance", AttendanceSchema);
