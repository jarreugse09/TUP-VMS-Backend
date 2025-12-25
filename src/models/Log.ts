import mongoose, { Document, Schema } from "mongoose";

export interface ILog extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  qrId: mongoose.Types.ObjectId;
  date: Date;
  timeIn: Date;
  timeOut?: Date;
  status: "In TUP" | "Checked Out";
  scannedBy: mongoose.Types.ObjectId;
}

const LogSchema: Schema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  qrId: { type: Schema.Types.ObjectId, ref: "QRCode", required: true },
  date: { type: Date, required: true },
  timeIn: { type: Date, required: true },
  timeOut: { type: Date },
  status: { type: String, enum: ["In TUP", "Checked Out"], required: true },
  scannedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
});

export default mongoose.model<ILog>("Log", LogSchema);
