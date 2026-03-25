import mongoose, { Document, Schema } from "mongoose";

export interface IQRRequest extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  requestType: "QR" | "PROFILE_PHOTO";
  oldQR?: string;
  reason: string;
  newQRString?: string;
  newQRImage?: string;
  oldPhotoURL?: string;
  newPhotoImage?: string;
  status: "Pending" | "Approved" | "Rejected";
  approvedBy?: mongoose.Types.ObjectId;
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
    enum: ["Pending", "Approved", "Rejected"],
    default: "Pending",
  },
  approvedBy: { type: Schema.Types.ObjectId, ref: "User" },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model<IQRRequest>("QRRequest", QRRequestSchema);
