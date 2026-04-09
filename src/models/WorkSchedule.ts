import mongoose, { Document, Schema } from "mongoose";

export interface IWorkSchedule extends Document {
  _id: mongoose.Types.ObjectId;
  name: string;
  days: string[];
  timeIn: string;
  timeOut: string;
  graceMinutes: number;
  isFlexible: boolean;
  createdBy?: mongoose.Types.ObjectId | null;
  createdAt: Date;
}

const WorkScheduleSchema: Schema = new Schema({
  name: { type: String, required: true, trim: true },
  days: [{ type: String, required: true }],
  timeIn: { type: String, required: true, trim: true },
  timeOut: { type: String, required: true, trim: true },
  graceMinutes: { type: Number, default: 15, min: 0 },
  isFlexible: { type: Boolean, default: false },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  createdAt: { type: Date, default: Date.now },
});

WorkScheduleSchema.index({ name: 1 }, { unique: true });

export default mongoose.model<IWorkSchedule>("WorkSchedule", WorkScheduleSchema);
