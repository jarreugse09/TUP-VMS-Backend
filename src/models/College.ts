import mongoose, { Document, Schema } from "mongoose";

export interface ICollege extends Document {
  _id: mongoose.Types.ObjectId;
  name: string;
  code: string;
  deanId?: mongoose.Types.ObjectId;
  createdAt: Date;
}

const CollegeSchema: Schema = new Schema({
  name: { type: String, required: true, unique: true, trim: true },
  code: { type: String, required: true, unique: true, trim: true },
  deanId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  createdAt: { type: Date, default: Date.now },
});

CollegeSchema.index({ name: 1 }, { unique: true });
CollegeSchema.index({ code: 1 }, { unique: true });

export default mongoose.model<ICollege>("College", CollegeSchema);
