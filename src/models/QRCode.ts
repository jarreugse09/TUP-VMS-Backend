import mongoose, { Document, Schema } from "mongoose";

export interface IQRCode extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  qrString: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const QRCodeSchema: Schema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  qrString: { type: String, required: true, unique: true },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

export default mongoose.model<IQRCode>("QRCode", QRCodeSchema);
