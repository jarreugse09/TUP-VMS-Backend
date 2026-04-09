import mongoose, { Document, Schema } from "mongoose";

export interface IDepartment extends Document {
  _id: mongoose.Types.ObjectId;
  name: string;
  collegeId?: mongoose.Types.ObjectId;
  createdAt: Date;
}

const DepartmentSchema: Schema = new Schema({
  name: { type: String, required: true, trim: true },
  collegeId: { type: Schema.Types.ObjectId, ref: "College", default: null },
  createdAt: { type: Date, default: Date.now },
});

DepartmentSchema.index({ name: 1, collegeId: 1 }, { unique: true });

export default mongoose.model<IDepartment>("Department", DepartmentSchema);
