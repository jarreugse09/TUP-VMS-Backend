import mongoose, { Document, Schema } from "mongoose";

export interface IPhotoUpdateRequest extends Document {
  _id: mongoose.Types.ObjectId;
  requesterId: mongoose.Types.ObjectId;
  newPhotoUrl: string;
  status: "pending" | "approved" | "rejected";
  reviewedBy?: mongoose.Types.ObjectId | null;
  reviewedAt?: Date | null;
  rejectionReason?: string | null;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const PhotoUpdateRequestSchema: Schema = new Schema(
  {
    requesterId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    newPhotoUrl: { type: String, required: true },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

PhotoUpdateRequestSchema.index({ requesterId: 1, status: 1 });
PhotoUpdateRequestSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model<IPhotoUpdateRequest>(
  "PhotoUpdateRequest",
  PhotoUpdateRequestSchema
);
