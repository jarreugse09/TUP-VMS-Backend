import mongoose, { Document, Schema } from "mongoose";
import { v4 as uuidv4 } from "uuid";

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
  qrCode: string;
  platesNumber?: string;
  isWFH: boolean;
  photoURL: string;
  email: string;
  passwordHash: string;
  status: "Active" | "In TUP" | "Inactive" | "Suspended" | "Blocked";
  mustCapturePhoto: boolean;
  // DPA 2012 compliance fields
  consentGiven: boolean;
  consentDate?: Date;
  dataRetentionDays: number;
  suspendedUntil?: Date | null;
  suspensionReason?: string | null;
  blockedReason?: string | null;
  blockedAt?: Date | null;
  refreshTokenHash?: string | null;
  refreshTokenExpiresAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
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
  subRole: { 
    type: String,
    enum: [
      "superadmin", 
      "top_management", 
      "dean", 
      "department_head", 
      "faculty", 
      "non_academic", 
      "maintenance", 
      "hr_head", 
      "hr_staff", 
      "security_head", 
      "security_staff"
    ]
  },
  staffType: { type: String },
  designation: { type: String, trim: true },
  officeUnit: { type: String, trim: true },
  collegeId: { type: Schema.Types.ObjectId, ref: "College", default: null },
  college: { type: String, trim: true },
  departmentId: { type: Schema.Types.ObjectId, ref: "Department", default: null },
  department: { type: String, trim: true },
  supervisorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  workScheduleId: { type: Schema.Types.ObjectId, ref: "WorkSchedule", default: null },
  qrCode: { type: String, required: true, unique: true, default: () => uuidv4() },
  platesNumber: { type: String, trim: true },
  isWFH: { type: Boolean, default: false },
  photoURL: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true, select: false },
  status: {
    type: String,
    enum: ["Active", "In TUP", "Inactive", "Suspended", "Blocked"],
    default: "Active",
  },
  suspendedUntil: { type: Date, default: null },
  suspensionReason: { type: String, default: null },
  blockedReason: { type: String, default: null },
  blockedAt: { type: Date, default: null },
  refreshTokenHash: { type: String, default: null, select: false },
  refreshTokenExpiresAt: { type: Date, default: null, select: false },
  mustCapturePhoto: { type: Boolean, default: false },
  // DPA 2012 — explicit consent tracking
  consentGiven: { type: Boolean, required: true, default: false },
  consentDate: { type: Date, default: null },
  dataRetentionDays: { type: Number, default: 1825 }, // 5 years per NPC guidelines
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// Performance indexes
UserSchema.index({ role: 1, subRole: 1, staffType: 1 });
UserSchema.index({ college: 1, department: 1 });
UserSchema.index({ collegeId: 1, departmentId: 1, supervisorId: 1 });
UserSchema.index({ workScheduleId: 1 });
UserSchema.index({ qrCode: 1 }, { unique: true });
UserSchema.index({ email: 1 }, { unique: true });

UserSchema.set("toJSON", {
  virtuals: true,
  transform: function (doc, ret) {
    delete ret.passwordHash;
    delete ret.__v;
    return ret;
  },
});

UserSchema.set("toObject", {
  virtuals: true,
  transform: function (doc, ret) {
    delete ret.passwordHash;
    delete ret.__v;
    return ret;
  },
});

export default mongoose.model<IUser>("User", UserSchema);
