import mongoose, { Document, Schema } from "mongoose";

export interface IAttendance extends Document {
  _id: mongoose.Types.ObjectId;
  staffId: mongoose.Types.ObjectId;
  date: Date;
  timeIn: Date;
  timeOut?: Date;
  totalHours?: number;
  scannedBy: mongoose.Types.ObjectId;
}

const AttendanceSchema: Schema = new Schema({
  staffId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  date: { type: Date, required: true },
  timeIn: { type: Date, required: true },
  timeOut: { type: Date, default: null },
  totalHours: { type: Number },
  scannedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
});

// Performance indexes
AttendanceSchema.index({ staffId: 1, date: -1 });

export default mongoose.model<IAttendance>("Attendance", AttendanceSchema);
