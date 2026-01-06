import mongoose, { Document, Schema } from "mongoose";

export interface ILog extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  transId: mongoose.Types.ObjectId;
  qrId: mongoose.Types.ObjectId;
  date: Date;
  timeIn: Date;
  timeOut?: Date;
  reason?: string;
  status: "In TUP" | "Checked Out";
  scannedBy: mongoose.Types.ObjectId;
  approvedBy?: string;
}

const LogSchema: Schema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  transId: { type: Schema.Types.ObjectId, ref: "User" },
  qrId: { type: Schema.Types.ObjectId, ref: "QRCode", required: true },
  date: { type: Date, required: true },
  timeIn: { type: Date, default: null },
  timeOut: { type: Date, default: null },
  status: { type: String, enum: ["In TUP", "Checked Out", 'Transaction'], required: true },
  reason: { type: String, default: null },
  scannedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  approvedBy: { type: String },
});

export default mongoose.model<ILog>("Log", LogSchema);
