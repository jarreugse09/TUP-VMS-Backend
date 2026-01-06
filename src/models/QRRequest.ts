import mongoose, { Document, Schema } from "mongoose";

export interface IQRRequest extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  oldQR: string;
  reason: string;
  newQRString?: string;
  newQRImage?: string;
  status: "Pending" | "Approved" | "Rejected";
  approvedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
}

const QRRequestSchema: Schema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  oldQR: { type: String, required: true },
  reason: { type: String, required: true },
  newQRString: { type: String },
  newQRImage: { type: String },
  status: {
    type: String,
    enum: ["Pending", "Approved", "Rejected"],
    default: "Pending",
  },
  approvedBy: { type: Schema.Types.ObjectId, ref: "User" },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model<IQRRequest>("QRRequest", QRRequestSchema);
