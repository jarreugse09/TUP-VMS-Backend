import mongoose, { Document, Schema } from "mongoose";

export interface ISpecialSchedule extends Document {
  _id: mongoose.Types.ObjectId;
  type: "wfh" | "holiday" | "exemption";
  scope: "individual" | "department" | "college" | "all";
  targetId?: mongoose.Types.ObjectId | null;
  date: Date;
  dateEnd?: Date | null;
  reason: string;
  approvedBy?: mongoose.Types.ObjectId | null;
  createdAt: Date;
}

const SpecialScheduleSchema: Schema = new Schema({
  type: {
    type: String,
    enum: ["wfh", "holiday", "exemption"],
    required: true,
  },
  scope: {
    type: String,
    enum: ["individual", "department", "college", "all"],
    required: true,
  },
  targetId: { type: Schema.Types.ObjectId, default: null },
  date: { type: Date, required: true },
  dateEnd: { type: Date, default: null },
  reason: { type: String, required: true, trim: true },
  approvedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  createdAt: { type: Date, default: Date.now },
});

SpecialScheduleSchema.index({ type: 1, scope: 1, date: 1, dateEnd: 1 });
SpecialScheduleSchema.index({ targetId: 1, date: 1 });

export default mongoose.model<ISpecialSchedule>(
  "SpecialSchedule",
  SpecialScheduleSchema,
);
