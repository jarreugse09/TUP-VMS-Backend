import express from "express";
import {
    sendMessage,
    getMessages,
    getUnreadCount,
    markAsRead,
    getOnlineUsers,
    getUsersByRole,
} from "../controllers/chatController";
import {
    authenticateToken,
    authorizeAlertAudience,
} from "../middlewares/auth";

const router = express.Router();

// ── Chat Routes (TUP and Security only) ───────────────────────────────────────
router.post("/send", authenticateToken, authorizeAlertAudience, sendMessage);
router.get("/messages", authenticateToken, authorizeAlertAudience, getMessages);
router.get("/unread-count", authenticateToken, authorizeAlertAudience, getUnreadCount);
router.patch("/mark-read", authenticateToken, authorizeAlertAudience, markAsRead);
router.get("/online-users", authenticateToken, authorizeAlertAudience, getOnlineUsers);
router.get("/users", authenticateToken, authorizeAlertAudience, getUsersByRole);

export default router;
