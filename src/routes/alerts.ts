import express from "express";
import {
    createAlert,
    getAlerts,
    getUnreadCount,
    markAsRead,
    markAllAsRead,
    deleteAlert,
} from "../controllers/alertController";
import {
    authenticateToken,
    authorizeRoles,
    authenticateApiKey,
} from "../middlewares/auth";

const router = express.Router();

// ── CCTV Webhook (API Key Auth) ───────────────────────────────────────────────
router.post("/", authenticateApiKey, createAlert);

// ── Authenticated Routes ──────────────────────────────────────────────────────
router.get("/", authenticateToken, authorizeRoles("TUP", "Security"), getAlerts);
router.get("/unread-count", authenticateToken, authorizeRoles("TUP", "Security"), getUnreadCount);
router.patch("/:id/read", authenticateToken, authorizeRoles("TUP", "Security"), markAsRead);
router.patch("/read-all", authenticateToken, authorizeRoles("TUP", "Security"), markAllAsRead);
router.delete("/:id", authenticateToken, authorizeRoles("TUP"), deleteAlert);

export default router;
