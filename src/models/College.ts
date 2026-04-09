import mongoose, { Document, Schema } from "mongoose";

export interface ICollege extends Document {
  _id: mongoose.Types.ObjectId;
  name: string;
  createdAt: Date;
}

const CollegeSchema: Schema = new Schema({
  name: { type: String, required: true, unique: true, trim: true },
  createdAt: { type: Date, default: Date.now },
});

CollegeSchema.index({ name: 1 }, { unique: true });

export default mongoose.model<ICollege>("College", CollegeSchema);
