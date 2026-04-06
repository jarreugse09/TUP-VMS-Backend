import mongoose, { Document, Schema } from "mongoose";

export interface IChatMessage extends Document {
    _id: mongoose.Types.ObjectId;
    senderId?: mongoose.Types.ObjectId;
    senderName: string;
    senderRole: "TUP" | "Staff" | "Security" | "System";
    recipientId?: mongoose.Types.ObjectId;
    message: string;
    isRead: boolean;
    readAt?: Date;
    createdAt: Date;
}

const ChatMessageSchema: Schema = new Schema(
    {
        senderId: { type: Schema.Types.ObjectId, ref: "User" },
        senderName: { type: String, required: true },
        senderRole: {
            type: String,
            enum: ["TUP", "Staff", "Security", "System"],
            required: true,
        },
        recipientId: { type: Schema.Types.ObjectId, ref: "User" },
        message: { type: String, required: true },
        isRead: { type: Boolean, default: false },
        readAt: { type: Date },
    },
    {
        timestamps: true,
    }
);

// Performance indexes
ChatMessageSchema.index({ createdAt: -1 });
ChatMessageSchema.index({ senderId: 1, createdAt: -1 });
ChatMessageSchema.index({ recipientId: 1, createdAt: -1 });
ChatMessageSchema.index({ isRead: 1, createdAt: -1 });

export default mongoose.model<IChatMessage>("ChatMessage", ChatMessageSchema);
