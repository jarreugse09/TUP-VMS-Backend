import mongoose, { Document, Schema } from "mongoose";

export interface ICsvUploadError {
  row: number;
  message: string;
}

export interface ICsvUploadLog extends Document {
  _id: mongoose.Types.ObjectId;
  uploadedBy: mongoose.Types.ObjectId;
  uploadType: "attendance" | "transaction" | "visit_log";
  fileName: string;
  recordsInserted: number;
  recordsFailed: number;
  uploadErrors: ICsvUploadError[];
  createdAt: Date;
  updatedAt: Date;
}

const CsvUploadLogSchema: Schema = new Schema(
  {
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    uploadType: {
      type: String,
      enum: ["attendance", "transaction", "visit_log"],
      required: true,
    },
    fileName: { type: String, required: true },
    recordsInserted: { type: Number, default: 0 },
    recordsFailed: { type: Number, default: 0 },
    uploadErrors: [
      {
        row: { type: Number },
        message: { type: String },
      },
    ],
  },
  { timestamps: true }
);

CsvUploadLogSchema.index({ uploadedBy: 1, createdAt: -1 });
CsvUploadLogSchema.index({ uploadType: 1, createdAt: -1 });

export default mongoose.model<ICsvUploadLog>("CsvUploadLog", CsvUploadLogSchema);
