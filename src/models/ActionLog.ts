import mongoose, { Document, Schema } from "mongoose";

export interface IActionLog extends Document {
  _id: mongoose.Types.ObjectId;
  action: string;
  performedBy?: mongoose.Types.ObjectId | null;     // plan: userId
  targetModel?: string;                      // plan: targetModel (e.g., "AttendanceLog", "User")
  targetId?: mongoose.Types.ObjectId;
  details: string;
  metadata?: Record<string, unknown>;
  severity: "info" | "warning" | "critical";
  ipAddress?: string;                        // plan requirement
  userAgent?: string;                        // plan requirement
  timestamp: Date;
  collegeId?: mongoose.Types.ObjectId;
  departmentId?: mongoose.Types.ObjectId;
}

const ActionLogSchema: Schema = new Schema({
  action: { type: String, required: true },
  performedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  targetModel: { type: String, default: null }, // e.g. "AttendanceLog", "User", "QRRequest"
  targetId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  details: { type: String, required: true },
  metadata: { type: Object, default: {} },
  severity: { 
    type: String, 
    enum: ["info", "warning", "critical"], 
    default: "info" 
  },
  ipAddress: { type: String, default: null },
  userAgent: { type: String, default: null },
  timestamp: { type: Date, default: Date.now },
  collegeId: { type: Schema.Types.ObjectId, ref: "College", default: null },
  departmentId: { type: Schema.Types.ObjectId, ref: "Department", default: null },
});

ActionLogSchema.index({ performedBy: 1, timestamp: -1 });
ActionLogSchema.index({ action: 1, timestamp: -1 });
ActionLogSchema.index({ collegeId: 1, timestamp: -1 });
ActionLogSchema.index({ departmentId: 1, timestamp: -1 });
ActionLogSchema.index({ severity: 1 });

export default mongoose.model<IActionLog>("ActionLog", ActionLogSchema);
