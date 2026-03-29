import mongoose, { Document, Schema } from "mongoose";

export interface IAlert extends Document {
    _id: mongoose.Types.ObjectId;
    type: "weapon" | "suspicious" | "system";
    title: string;
    message: string;
    cameraSource: string;
    detectionLabel: string;
    confidence: number;
    severity: "critical" | "high" | "medium" | "low";
    imageUrl?: string;
    isRead: boolean;
    readBy?: mongoose.Types.ObjectId;
    readAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const AlertSchema: Schema = new Schema(
    {
        type: {
            type: String,
            enum: ["weapon", "suspicious", "system"],
            required: true,
        },
        title: { type: String, required: true },
        message: { type: String, required: true },
        cameraSource: { type: String, required: true },
        detectionLabel: { type: String, required: true },
        confidence: { type: Number, required: true, min: 0, max: 1 },
        severity: {
            type: String,
            enum: ["critical", "high", "medium", "low"],
            required: true,
        },
        imageUrl: { type: String },
        isRead: { type: Boolean, default: false },
        readBy: { type: Schema.Types.ObjectId, ref: "User" },
        readAt: { type: Date },
    },
    {
        timestamps: true,
    }
);

// Performance indexes
AlertSchema.index({ createdAt: -1 });
AlertSchema.index({ isRead: 1, createdAt: -1 });
AlertSchema.index({ type: 1, createdAt: -1 });
AlertSchema.index({ severity: 1, createdAt: -1 });

export default mongoose.model<IAlert>("Alert", AlertSchema);
