import mongoose, { Document, Schema } from "mongoose";

export interface IAttendance extends Document {
  _id: mongoose.Types.ObjectId;
  staffId: mongoose.Types.ObjectId;
  date: Date;
  timeIn?: Date | null;
  timeOut?: Date | null;
  breakStart?: Date | null;
  breakEnd?: Date | null;
  totalHours?: number;
  scannedBy?: mongoose.Types.ObjectId | null;
  platesNumber?: string | null;
  status?: "present" | "late" | "absent" | "wfh" | "holiday" | "exempt" | "present (unscheduled)";
  goOutEntries?: Array<{
    goOutTime: Date;
    goInTime: Date | null;
    reason: string;
    approvedBy: mongoose.Types.ObjectId | null;
  }>;
  notes?: string | null;
  collegeId?: mongoose.Types.ObjectId;
  departmentId?: mongoose.Types.ObjectId;
  deletedAt?: Date | null;
}

const AttendanceSchema: Schema = new Schema({
  staffId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  date: { type: Date, required: true },
  timeIn: { type: Date, default: null },
  timeOut: { type: Date, default: null },
  breakStart: { type: Date, default: null },
  breakEnd: { type: Date, default: null },
  totalHours: { type: Number },
  scannedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  platesNumber: { type: String, default: null },
  status: {
    type: String,
    enum: ["present", "late", "absent", "wfh", "holiday", "exempt", "present (unscheduled)"],
    default: "present",
  },
  goOutEntries: [{
    goOutTime: { type: Date, required: true },
    goInTime: { type: Date, default: null },
    reason: { type: String, required: true },
    approvedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  }],
  notes: { type: String, default: null },
  collegeId: { type: Schema.Types.ObjectId, ref: "College", default: null },
  departmentId: { type: Schema.Types.ObjectId, ref: "Department", default: null },
  deletedAt: { type: Date, default: null },
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Performance indexes
AttendanceSchema.index({ staffId: 1, date: -1 });
AttendanceSchema.index({ date: -1, status: 1 });
AttendanceSchema.index({ collegeId: 1, date: -1 });
AttendanceSchema.index({ departmentId: 1, date: -1 });

// M6: Add virtual `userId` alias mapping to `staffId` for consistent naming
// Both names work without a breaking schema migration
AttendanceSchema.virtual("userId").get(function (this: IAttendance) {
  return this.staffId;
});

export default mongoose.model<IAttendance>("Attendance", AttendanceSchema);

