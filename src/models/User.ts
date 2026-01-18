import mongoose, { Document, Schema } from "mongoose";

export interface IUser extends Document {
  _id: mongoose.Types.ObjectId;
  firstName: string;
  surname: string;
  birthdate: Date;
  role: "TUP" | "Staff" | "Student" | "Visitor";
  staffType?: string;
  photoURL: string;
  email: string;
  passwordHash: string;
  status: "Active" | "In TUP" | "Inactive";
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
  staffType: { type: String },
  photoURL: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  status: {
    type: String,
    enum: ["Active", "In TUP", "Inactive"],
    default: "Active",
  },
  createdAt: { type: Date, default: Date.now },
});

// Performance indexes
UserSchema.index({ role: 1 });

export default mongoose.model<IUser>("User", UserSchema);
