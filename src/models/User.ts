import mongoose, { Document, Schema } from "mongoose";

export interface IUser extends Document {
  _id: mongoose.Types.ObjectId;
  firstName: string;
  surname: string;
  birthdate: Date;
  role: "TUP" | "Staff" | "Student" | "Visitor";
  subRole?: string;
  staffType?: string;
  designation?: string;
  officeUnit?: string;
  collegeId?: mongoose.Types.ObjectId;
  college?: string;
  departmentId?: mongoose.Types.ObjectId;
  department?: string;
  supervisorId?: mongoose.Types.ObjectId;
  workScheduleId?: mongoose.Types.ObjectId;
  photoURL: string;
  email: string;
  passwordHash: string;
  status: "Active" | "In TUP" | "Inactive";
  mustCapturePhoto: boolean;
  createdAt: Date;
}

const UserSchema: Schema = new Schema({
  firstName: { type: String, required: true },
  surname: { type: String, required: true },
  birthdate: { type: Date, required: true },
  role: {
    type: String,
    enum: ["TUP", "Staff", "Student", "Visitor"],
    required: true,
  },
  subRole: { type: String },
  staffType: { type: String },
  designation: { type: String, trim: true },
  officeUnit: { type: String, trim: true },
  collegeId: { type: Schema.Types.ObjectId, ref: "College", default: null },
  college: { type: String, trim: true },
  departmentId: { type: Schema.Types.ObjectId, ref: "Department", default: null },
  department: { type: String, trim: true },
  supervisorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  workScheduleId: { type: Schema.Types.ObjectId, ref: "WorkSchedule", default: null },
  photoURL: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  status: {
    type: String,
    enum: ["Active", "In TUP", "Inactive"],
    default: "Active",
  },
  mustCapturePhoto: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

// Performance indexes
UserSchema.index({ role: 1, subRole: 1, staffType: 1 });
UserSchema.index({ college: 1, department: 1 });
UserSchema.index({ collegeId: 1, departmentId: 1, supervisorId: 1 });
UserSchema.index({ workScheduleId: 1 });

export default mongoose.model<IUser>("User", UserSchema);
