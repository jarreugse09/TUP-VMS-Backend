import express from "express";
import {
    createAlert,
    getAlerts,
    getUnreadCount,
    markAsRead,
    markAllAsRead,
    deleteAlert,
    updateIncidentStatus,
} from "../controllers/alertController";
import {
    authenticateToken,
    authorizeRoles,
    authenticateApiKey,
    authorizeAlertAudience,
} from "../middlewares/auth";

const router = express.Router();

// ── CCTV Webhook (API Key Auth) ───────────────────────────────────────────────
router.post("/", authenticateApiKey, createAlert);

// ── Authenticated Routes ──────────────────────────────────────────────────────
router.get("/", authenticateToken, authorizeAlertAudience, getAlerts);
router.get("/unread-count", authenticateToken, authorizeAlertAudience, getUnreadCount);
router.patch("/:id/read", authenticateToken, authorizeAlertAudience, markAsRead);
router.patch("/read-all", authenticateToken, authorizeAlertAudience, markAllAsRead);
router.patch("/:id/status", authenticateToken, authorizeAlertAudience, updateIncidentStatus);
router.delete("/:id", authenticateToken, authorizeRoles("TUP"), deleteAlert);

export default router;
