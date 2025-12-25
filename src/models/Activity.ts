import mongoose, { Document, Schema } from "mongoose";

export interface IActivity extends Document {
  _id: mongoose.Types.ObjectId;
  fromUserId: mongoose.Types.ObjectId;
  toUserId: mongoose.Types.ObjectId;
  fromQR: string;
  toQR: string;
  activityType: string;
  timestamp: Date;
}

const ActivitySchema: Schema = new Schema({
  fromUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  toUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  fromQR: { type: String, required: true },
  toQR: { type: String, required: true },
  activityType: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
});

export default mongoose.model<IActivity>("Activity", ActivitySchema);
