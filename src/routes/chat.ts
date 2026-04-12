import express from "express";
import {
    sendMessage,
    getMessages,
    getUnreadCount,
    markAsRead,
    getOnlineUsers,
    getUsersByRole,
    markMessageUnread,
    deleteMessage
} from "../controllers/chatController";
import {
    authenticateToken,
    authorizeChatAccess,
} from "../middlewares/auth";

const router = express.Router();

// ── Chat Routes (TUP and Security only) ───────────────────────────────────────
router.post("/send", authenticateToken, authorizeChatAccess, sendMessage);
router.post("/messages", authenticateToken, authorizeChatAccess, sendMessage);
router.get("/messages", authenticateToken, authorizeChatAccess, getMessages);
router.get("/unread-count", authenticateToken, authorizeChatAccess, getUnreadCount);
router.post("/mark-read", authenticateToken, authorizeChatAccess, markAsRead);
router.patch("/mark-read", authenticateToken, authorizeChatAccess, markAsRead);
router.get("/online-users", authenticateToken, authorizeChatAccess, getOnlineUsers);
router.get("/users", authenticateToken, authorizeChatAccess, getUsersByRole);
router.post("/mark-unread", authenticateToken, authorizeChatAccess, markMessageUnread);
router.delete("/messages/:id", authenticateToken, authorizeChatAccess, deleteMessage);

export default router;
