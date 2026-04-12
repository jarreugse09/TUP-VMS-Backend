import mongoose, { Document, Schema } from "mongoose";

export interface IVisitLog extends Document {
  _id: mongoose.Types.ObjectId;
  visitorId: mongoose.Types.ObjectId;
  hostId?: mongoose.Types.ObjectId; // The staff member being visited
  date: Date;
  timeIn: Date;
  timeOut?: Date;
  purpose: string;
  scannedBy: mongoose.Types.ObjectId;
  platesNumber?: string;
  collegeId?: mongoose.Types.ObjectId;
  departmentId?: mongoose.Types.ObjectId;
  incompleteExit: boolean; // flagged at 23:00 if timeOut is still null
}

const VisitLogSchema: Schema = new Schema({
  visitorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  hostId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  date: { type: Date, required: true },
  timeIn: { type: Date, required: true },
  timeOut: { type: Date, default: null },
  purpose: { type: String, required: true },
  scannedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  platesNumber: { type: String, default: null },
  collegeId: { type: Schema.Types.ObjectId, ref: "College", default: null },
  departmentId: { type: Schema.Types.ObjectId, ref: "Department", default: null },
  incompleteExit: { type: Boolean, default: false },
}, { timestamps: true });

// Performance indexes for siloing
VisitLogSchema.index({ visitorId: 1, date: -1 });
VisitLogSchema.index({ hostId: 1, date: -1 });
VisitLogSchema.index({ collegeId: 1, date: -1 });
VisitLogSchema.index({ date: -1 });

export default mongoose.model<IVisitLog>("VisitLog", VisitLogSchema);
