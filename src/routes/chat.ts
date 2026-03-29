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
    authorizeRoles,
} from "../middlewares/auth";

const router = express.Router();

// ── Chat Routes (TUP and Security only) ───────────────────────────────────────
router.post("/send", authenticateToken, authorizeRoles("TUP", "Security"), sendMessage);
router.get("/messages", authenticateToken, authorizeRoles("TUP", "Security"), getMessages);
router.get("/unread-count", authenticateToken, authorizeRoles("TUP", "Security"), getUnreadCount);
router.patch("/mark-read", authenticateToken, authorizeRoles("TUP", "Security"), markAsRead);
router.get("/online-users", authenticateToken, authorizeRoles("TUP", "Security"), getOnlineUsers);
router.get("/users", authenticateToken, authorizeRoles("TUP", "Security"), getUsersByRole);

export default router;
