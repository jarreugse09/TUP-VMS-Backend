import mongoose, { Document, Schema } from "mongoose";

export interface IAlert extends Document {
    _id: mongoose.Types.ObjectId;
    type: "weapon" | "suspicious" | "system";
    title: string;
    message: string;
    cameraSource: string;
    detectionLabel: string;
    detectedObjects?: string[];
    confidence: number;
    severity: "critical" | "high" | "medium" | "low";
    imageUrl?: string;
    recipientStates: Array<{
        userId: mongoose.Types.ObjectId;
        isRead: boolean;
        readAt?: Date;
        incidentStatus: "new" | "acknowledged" | "in_progress" | "resolved";
        acknowledgedBy?: mongoose.Types.ObjectId;
        acknowledgedAt?: Date;
        resolvedBy?: mongoose.Types.ObjectId;
        resolvedAt?: Date;
    }>;
    createdAt: Date;
    updatedAt: Date;
}

const AlertRecipientStateSchema = new Schema(
    {
        userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
        isRead: { type: Boolean, default: false },
        readAt: { type: Date },
        incidentStatus: {
            type: String,
            enum: ["new", "acknowledged", "in_progress", "resolved"],
            default: "new",
        },
        acknowledgedBy: { type: Schema.Types.ObjectId, ref: "User" },
        acknowledgedAt: { type: Date },
        resolvedBy: { type: Schema.Types.ObjectId, ref: "User" },
        resolvedAt: { type: Date },
    },
    { _id: false }
);

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
        detectedObjects: [{ type: String }],
        confidence: { type: Number, required: true, min: 0, max: 1 },
        severity: {
            type: String,
            enum: ["critical", "high", "medium", "low"],
            required: true,
        },
        imageUrl: { type: String },
        recipientStates: {
            type: [AlertRecipientStateSchema],
            default: [],
        },
    },
    {
        timestamps: true,
    }
);

// Performance indexes
AlertSchema.index({ createdAt: -1 });
AlertSchema.index({ type: 1, createdAt: -1 });
AlertSchema.index({ severity: 1, createdAt: -1 });
AlertSchema.index({ "recipientStates.userId": 1, createdAt: -1 });
AlertSchema.index({ "recipientStates.userId": 1, "recipientStates.isRead": 1, createdAt: -1 });

export default mongoose.model<IAlert>("Alert", AlertSchema);
