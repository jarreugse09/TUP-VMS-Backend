import { Request, Response, type NextFunction } from "express";
import ChatMessage from "../models/ChatMessage";
import User from "../models/User";
import { catchAsync } from "../utils/catchAsync";
import { AppError } from "../utils/AppError";
import { buildSecurityAudienceQuery, getEffectiveRole } from "../utils/rbac";
import { broadcastChatMessage } from "../websocket";

interface AuthRequest extends Request {
    user?: any;
}

const normalizeChatMessage = (message: any) => ({
    _id: String(message._id),
    senderId: message.senderId?._id
        ? String(message.senderId._id)
        : message.senderId
          ? String(message.senderId)
          : null,
    senderName: message.senderName,
    senderRole: message.senderRole,
    recipientId: message.recipientId?._id
        ? String(message.recipientId._id)
        : message.recipientId
          ? String(message.recipientId)
          : null,
    message: message.message,
    isRead: Boolean(message.isRead),
    createdAt: message.createdAt,
});

// ─── SEND MESSAGE ─────────────────────────────────────────────────────────────
export const sendMessage = catchAsync(
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        const { message, recipientId } = req.body;

        if (!message) {
            return next(new AppError("Message is required", 400));
        }

        const chatMessage = await ChatMessage.create({
            senderId: req.user._id,
            senderName: `${req.user.firstName} ${req.user.surname}`,
            senderRole: getEffectiveRole(req.user),
            recipientId: recipientId || null,
            message,
        });

        const recipientUserIds = recipientId
            ? [String(recipientId), String(req.user._id)]
            : undefined;

        broadcastChatMessage(chatMessage, recipientUserIds);

        res.status(201).json({
            status: "success",
            data: chatMessage,
        });
    }
);

// ─── GET MESSAGES ─────────────────────────────────────────────────────────────
export const getMessages = catchAsync(
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 50;
        const skip = (page - 1) * limit;

        const filter: any = {
            $or: [
                { senderId: req.user._id },
                { recipientId: req.user._id },
            ],
        };

        const messages = await ChatMessage.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate("senderId", "firstName surname role")
            .populate("recipientId", "firstName surname role");

        const total = await ChatMessage.countDocuments(filter);

        res.status(200).json({
            status: "success",
            data: messages.reverse().map(normalizeChatMessage), // Return in chronological order
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit),
            },
        });
    }
);

// ─── GET UNREAD COUNT ─────────────────────────────────────────────────────────
export const getUnreadCount = catchAsync(
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        const count = await ChatMessage.countDocuments({
            isRead: false,
            senderId: { $ne: req.user._id }, // Not sent by current user
            recipientId: req.user._id,
        });

        res.status(200).json({
            status: "success",
            data: { count },
        });
    }
);

// ─── MARK MESSAGES AS READ ────────────────────────────────────────────────────
export const markAsRead = catchAsync(
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        const { messageIds } = req.body;

        if (!messageIds || !Array.isArray(messageIds)) {
            return next(new AppError("Message IDs are required", 400));
        }

        await ChatMessage.updateMany(
            {
                _id: { $in: messageIds },
                senderId: { $ne: req.user._id }, // Only mark others' messages as read
                recipientId: req.user._id,
            },
            {
                isRead: true,
                readAt: new Date(),
            }
        );

        res.status(200).json({
            status: "success",
            message: "Messages marked as read",
        });
    }
);

// ─── GET USERS BY ROLE ─────────────────────────────────────────────────────────
export const getUsersByRole = catchAsync(
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        const roles = req.query.roles as string;

        if (!roles) {
            return next(new AppError("Roles parameter is required", 400));
        }

        const roleArray = roles.split(",").map(role => role.trim());
        const wantsSecurity = roleArray.some(
            role => role.toLowerCase() === "security"
        );
        const normalizedRoles = roleArray.filter(
            role => role.toLowerCase() !== "security"
        );

        const filters: any[] = [];
        if (normalizedRoles.length > 0) {
            filters.push({ role: { $in: normalizedRoles } });
        }
        if (wantsSecurity) {
            filters.push(buildSecurityAudienceQuery());
        }

        const users = await User.find({
            _id: { $ne: req.user._id }, // Exclude current user
            ...(filters.length > 0 ? { $or: filters } : {}),
        }).select("firstName surname role staffType email");

        res.status(200).json({
            status: "success",
            data: users,
        });
    }
);

// ─── GET ONLINE USERS ─────────────────────────────────────────────────────────
export const getOnlineUsers = catchAsync(
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        // This will be populated by WebSocket connections
        // For now, return empty array - will be updated when WebSocket is implemented
        res.status(200).json({
            status: "success",
            data: [],
        });
    }
);
