import mongoose, { Document, Schema } from "mongoose";

export interface IAlert extends Document {
    _id: mongoose.Types.ObjectId;
    type: "weapon" | "suspicious" | "intrusion" | "loitering" | "unattended" | "other";
    title: string;
    message: string;
    cameraSource: string;                        // plan: zoneId
    detectionLabel: string;
    detectedObjects?: string[];
    confidence: number;
    severity: "critical" | "high" | "medium" | "low";
    imageUrl?: string;
    // Plan fields added for role-based routing
    audience: string[];                          // e.g. ["security_head", "superadmin"]
    collegeId?: mongoose.Types.ObjectId;         // for college-scoped alerts
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
    globalIncidentStatus: "new" | "acknowledged" | "resolved"; // plan: status = "active | responded | false_alarm"
    responderId?: mongoose.Types.ObjectId;
    resolutionNote?: string;
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
            enum: ["weapon", "suspicious", "intrusion", "loitering", "unattended", "other"],
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
        // Plan Section 3.11 — role-based audience routing
        audience: [{ type: String }],            // e.g. ["security_head", "superadmin"]
        collegeId: { type: Schema.Types.ObjectId, ref: "College", default: null },
        recipientStates: {
            type: [AlertRecipientStateSchema],
            default: [],
        },
        globalIncidentStatus: {
            type: String,
            enum: ["new", "acknowledged", "resolved"],
            default: "new",
        },
        responderId: { type: Schema.Types.ObjectId, ref: "User" },
        resolutionNote: { type: String },
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
