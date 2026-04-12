import mongoose, { Document, Schema } from "mongoose";

export interface IDepartment extends Document {
  _id: mongoose.Types.ObjectId;
  name: string;
  code: string;
  collegeId?: mongoose.Types.ObjectId;
  headId?: mongoose.Types.ObjectId;
  createdAt: Date;
}

const DepartmentSchema: Schema = new Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, trim: true },
  collegeId: { type: Schema.Types.ObjectId, ref: "College", default: null },
  headId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  createdAt: { type: Date, default: Date.now },
});

DepartmentSchema.index({ name: 1, collegeId: 1 });
DepartmentSchema.index({ code: 1 }, { unique: true });

export default mongoose.model<IDepartment>("Department", DepartmentSchema);
