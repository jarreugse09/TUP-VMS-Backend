import mongoose, { Document, Schema } from "mongoose";

export interface IChatMessage extends Document {
    _id: mongoose.Types.ObjectId;
    senderId?: mongoose.Types.ObjectId;
    senderName: string;
    senderRole: "TUP" | "Staff" | "Security" | "System";
    recipientId?: mongoose.Types.ObjectId;   // plan: receiverId (DM target)
    groupId?: string;                         // plan: "security" | null (group chat)
    message: string;                          // plan: content
    readBy: mongoose.Types.ObjectId[];        // plan: readBy[] (multi-user)
    isRead: boolean;                          // legacy single-user flag kept for compat
    readAt?: Date;
    // Thread & reply fields
    replyTo?: mongoose.Types.ObjectId | null;   // parent message this replies to
    threadId?: mongoose.Types.ObjectId | null;  // root message of the thread (null if root)
    mentions: mongoose.Types.ObjectId[];         // mentioned user IDs
    isSystemMessage: boolean;                    // true for Hawkeye-generated messages
    deletedAt?: Date | null;
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
        recipientId: { type: Schema.Types.ObjectId, ref: "User" },   // DM target
        groupId: { type: String, default: "security_general" },                      // "security_general"
        message: { type: String, required: true },
        readBy: [{ type: Schema.Types.ObjectId, ref: "User" }],       // multi-user read tracking
        isRead: { type: Boolean, default: false },
        readAt: { type: Date },
        // Thread, reply, mention fields
        replyTo: { type: Schema.Types.ObjectId, ref: "ChatMessage", default: null },
        threadId: { type: Schema.Types.ObjectId, ref: "ChatMessage", default: null },
        mentions: [{ type: Schema.Types.ObjectId, ref: "User" }],
        isSystemMessage: { type: Boolean, default: false },
        deletedAt: { type: Date, default: null },
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
