import { Request, Response, type NextFunction } from "express";
import mongoose from "mongoose";
import ChatMessage, { IChatMessage } from "../models/ChatMessage";
import User from "../models/User";
import { catchAsync } from "../utils/catchAsync";
import { AppError } from "../utils/AppError";
import { getEffectiveRole } from "../utils/rbac";
import { broadcastChatMessage } from "../websocket";
import { logAction } from "../utils/actionLogger";
import { requireValidObjectId } from "../utils/validate";

interface AuthenticatedUser {
  _id: string;
  id?: string;
  firstName: string;
  surname: string;
  subRole?: string;
}

interface AuthRequest extends Request {
  user?: AuthenticatedUser;
}

interface PopulatedReplyPreview {
  _id: mongoose.Types.ObjectId;
  senderName?: string;
  message?: string;
  isSystemMessage?: boolean;
}

interface NormalizedChatMessage {
  _id: string;
  senderId: string | null;
  senderName: string;
  senderRole: string;
  recipientId: string | null;
  content: string;
  message: string;
  readBy: string[];
  groupId: string | null;
  isRead: boolean;
  replyTo: {
    _id: string;
    senderName: string;
    message: string;
    isSystemMessage: boolean;
  } | null;
  isSystemMessage: boolean;
  mentions: string[];
  threadId: string | null;
  replyCount: number;
  deletedAt: Date | null;
  createdAt: Date;
}

const SECURITY_GENERAL_GROUP_ID = "security_general";

const normalizeChatMessage = (
  message: IChatMessage & {
    senderId?: mongoose.Types.ObjectId | null;
    replyTo?: PopulatedReplyPreview | mongoose.Types.ObjectId | null;
    mentions?: mongoose.Types.ObjectId[];
    readBy?: mongoose.Types.ObjectId[];
  },
  replyCount: number,
  currentUserId: string,
): NormalizedChatMessage => {
  const replySource = message.replyTo;
  const replyPreview =
    replySource &&
    typeof replySource === "object" &&
    "_id" in replySource &&
    "senderName" in replySource
      ? {
          _id: String(replySource._id),
          senderName: typeof replySource.senderName === "string" ? replySource.senderName : "Unknown",
          message: typeof replySource.message === "string" ? replySource.message : "",
          isSystemMessage: Boolean(replySource.isSystemMessage),
        }
      : null;

  const readBy = Array.isArray(message.readBy)
    ? message.readBy.map((entry) => String(entry))
    : [];

  return {
    _id: String(message._id),
    senderId: message.senderId ? String(message.senderId) : null,
    senderName: message.senderName,
    senderRole: message.senderRole,
    recipientId: message.recipientId ? String(message.recipientId) : null,
    content: message.message,
    message: message.message,
    readBy,
    groupId: message.groupId || null,
    isRead: readBy.includes(currentUserId),
    replyTo: replyPreview,
    isSystemMessage: Boolean(message.isSystemMessage),
    mentions: Array.isArray(message.mentions)
      ? message.mentions.map((entry) => String(entry))
      : [],
    threadId: message.threadId ? String(message.threadId) : null,
    replyCount,
    deletedAt: message.deletedAt || null,
    createdAt: message.createdAt,
  };
};

export const sendMessage = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { content, message, replyTo, mentions, threadId } = req.body as {
      content?: string;
      message?: string;
      replyTo?: string;
      mentions?: string[];
      threadId?: string;
    };

    const payload = (content ?? message ?? "").trim();
    if (!payload) {
      return next(new AppError("Message content is required", 400));
    }

    const senderId = req.user?._id || req.user?.id;
    if (!senderId) {
      return next(new AppError("Unauthorized", 401));
    }

    if (replyTo && !mongoose.Types.ObjectId.isValid(replyTo)) {
      return next(new AppError("Invalid reply target", 400));
    }
    if (threadId && !mongoose.Types.ObjectId.isValid(threadId)) {
      return next(new AppError("Invalid thread target", 400));
    }

    const mentionedIds = Array.isArray(mentions)
      ? mentions.filter((value) => mongoose.Types.ObjectId.isValid(value))
      : [];

    const chatMessage = await ChatMessage.create({
      senderId,
      senderName: `${req.user?.firstName || ""} ${req.user?.surname || ""}`.trim(),
      senderRole: getEffectiveRole(req.user),
      recipientId: null,
      groupId: SECURITY_GENERAL_GROUP_ID,
      message: payload,
      replyTo: replyTo || undefined,
      isSystemMessage: false,
      mentions: mentionedIds,
      threadId: threadId || undefined,
      readBy: [senderId],
    });

    broadcastChatMessage(chatMessage);

    res.status(201).json({
      status: "success",
      data: normalizeChatMessage(chatMessage, 0, String(senderId)),
    });
  },
);

export const getMessages = catchAsync(
  async (req: AuthRequest, res: Response) => {
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const skip = (page - 1) * limit;
    const threadId = req.query.threadId as string | undefined;
    const currentUserId = String(req.user?._id || req.user?.id || "");

    if (threadId && !mongoose.Types.ObjectId.isValid(threadId)) {
      throw new AppError("Invalid thread ID", 400);
    }

    const filter: Record<string, unknown> = {
      groupId: SECURITY_GENERAL_GROUP_ID,
      deletedAt: null,
      ...(threadId ? { threadId } : { threadId: null }),
    };

    const messages = await ChatMessage.find(filter)
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(limit)
      .populate("replyTo", "senderName message isSystemMessage")
      .lean();

    const rootIds = threadId
      ? []
      : messages.map((entry) => entry._id).filter(Boolean);

    const replyCounts = rootIds.length > 0
      ? await ChatMessage.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
          { $match: { threadId: { $in: rootIds }, deletedAt: null } },
          { $group: { _id: "$threadId", count: { $sum: 1 } } },
        ])
      : [];

    const replyCountMap = new Map(
      replyCounts.map((entry) => [String(entry._id), entry.count]),
    );

    const unreadFilter: Record<string, unknown> = {
      groupId: SECURITY_GENERAL_GROUP_ID,
      senderId: { $ne: req.user?._id },
      readBy: { $nin: [req.user?._id] },
      deletedAt: null,
      ...(threadId ? { threadId } : { threadId: null }),
    };

    await ChatMessage.updateMany(unreadFilter, {
      $addToSet: { readBy: req.user?._id },
      $set: { isRead: true, readAt: new Date() },
    });

    const normalized = messages.map((entry) =>
      normalizeChatMessage(entry as IChatMessage, replyCountMap.get(String(entry._id)) || 0, currentUserId),
    );

    const total = await ChatMessage.countDocuments(filter);

    res.status(200).json({
      status: "success",
      data: normalized,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  },
);

export const getUnreadCount = catchAsync(
  async (req: AuthRequest, res: Response) => {
    const count = await ChatMessage.countDocuments({
      groupId: SECURITY_GENERAL_GROUP_ID,
      senderId: { $ne: req.user?._id },
      readBy: { $nin: [req.user?._id] },
      deletedAt: null,
    });

    res.status(200).json({
      status: "success",
      data: { count },
    });
  },
);

export const markAsRead = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { messageIds } = req.body as { messageIds?: string[] };

    if (messageIds && !Array.isArray(messageIds)) {
      return next(new AppError("messageIds must be an array when provided", 400));
    }

    const filter: Record<string, unknown> = {
      groupId: SECURITY_GENERAL_GROUP_ID,
      senderId: { $ne: req.user?._id },
      readBy: { $nin: [req.user?._id] },
      deletedAt: null,
    };

    if (messageIds && messageIds.length > 0) {
      filter._id = {
        $in: messageIds.filter((value) => mongoose.Types.ObjectId.isValid(value)),
      };
    }

    await ChatMessage.updateMany(filter, {
      $addToSet: { readBy: req.user?._id },
      $set: { isRead: true, readAt: new Date() },
    });

    res.status(200).json({
      status: "success",
      message: "Messages marked as read",
    });
  },
);

export const getUsersByRole = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const roles = req.query.roles as string;

    if (!roles) {
      return next(new AppError("Roles parameter is required", 400));
    }

    const roleArray = roles.split(",").map((role) => role.trim());
    const users = await User.find({
      _id: { $ne: req.user?._id },
      $or: [
        { role: { $in: roleArray } },
        { subRole: { $in: roleArray } },
      ],
    }).select("firstName surname role subRole email");

    res.status(200).json({
      status: "success",
      data: users,
    });
  },
);

export const getOnlineUsers = catchAsync(async (_req: AuthRequest, res: Response) => {
  res.status(200).json({
    status: "success",
    data: [],
  });
});

export const markMessageUnread = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { messageId } = req.body as { messageId?: string };
    if (!messageId) {
      return next(new AppError("messageId is required", 400));
    }

    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      return next(new AppError("Invalid messageId", 400));
    }

    await ChatMessage.findByIdAndUpdate(messageId, {
      $pull: { readBy: req.user?._id },
      $set: { isRead: false, readAt: null },
    });

    res.status(200).json({ ok: true });
  },
);

export const deleteMessage = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { id } = req.params;

    if (!requireValidObjectId(id, res)) return;

    const message = await ChatMessage.findOne({ _id: id, deletedAt: null });
    if (!message) {
      return next(new AppError("Message not found", 404));
    }

    if (message.isSystemMessage) {
      return next(new AppError("System alert messages cannot be deleted.", 403));
    }

    if (String(message.senderId) !== String(req.user?._id)) {
      return next(new AppError("You can only delete your own messages", 403));
    }

    message.deletedAt = new Date();
    await message.save();

    await logAction(req, "CHAT_MESSAGE_DELETED", "ChatMessage", id, "Chat message discarded");

    res.status(200).json({ deleted: true });
  },
);
