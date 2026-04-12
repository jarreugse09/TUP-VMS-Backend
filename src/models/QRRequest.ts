import mongoose, { Document, Schema } from "mongoose";

export interface IQRRequest extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;           // plan: requesterId
  requestType: "QR" | "PROFILE_PHOTO";
  oldQR?: string;
  reason: string;
  newQRString?: string;
  newQRImage?: string;
  oldPhotoURL?: string;
  newPhotoImage?: string;
  status: "pending" | "approved" | "rejected" | "Pending" | "Approved" | "Rejected"; // normalized in v2
  approvedBy?: mongoose.Types.ObjectId;      // legacy alias — prefer reviewedBy
  reviewedBy?: mongoose.Types.ObjectId;      // plan: reviewedBy
  reviewedAt?: Date;                         // plan: reviewedAt
  isDeleted: boolean;
  deletedAt?: Date | null;
  createdAt: Date;
}

const QRRequestSchema: Schema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  requestType: {
    type: String,
    enum: ["QR", "PROFILE_PHOTO"],
    default: "QR",
    required: true,
  },
  oldQR: { type: String },
  reason: { type: String, required: true },
  newQRString: { type: String },
  newQRImage: { type: String },
  oldPhotoURL: { type: String },
  newPhotoImage: { type: String },
  status: {
    type: String,
    enum: ["Pending", "Approved", "Rejected", "pending", "approved", "rejected"],
    default: "Pending",
  },
  approvedBy: { type: Schema.Types.ObjectId, ref: "User" },
  reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  reviewedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
});

export default mongoose.model<IQRRequest>("QRRequest", QRRequestSchema);
