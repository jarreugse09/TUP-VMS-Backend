import mongoose, { Document, Schema } from "mongoose";

export interface IBackupLog extends Document {
  _id: mongoose.Types.ObjectId;
  createdBy: mongoose.Types.ObjectId;
  backupType: "manual" | "scheduled";
  fileName: string;
  sizeBytes?: number;
  status: "success" | "failed";
  createdAt: Date;
  updatedAt: Date;
}

const BackupLogSchema: Schema = new Schema(
  {
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    backupType: {
      type: String,
      enum: ["manual", "scheduled"],
      default: "manual",
    },
    fileName: { type: String, required: true },
    sizeBytes: { type: Number },
    status: {
      type: String,
      enum: ["success", "failed"],
      required: true,
    },
  },
  { timestamps: true }
);

BackupLogSchema.index({ createdBy: 1, createdAt: -1 });
BackupLogSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model<IBackupLog>("BackupLog", BackupLogSchema);
