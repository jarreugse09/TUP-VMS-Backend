import { Request, Response, type NextFunction } from "express";
import Alert from "../models/Alert";
import ChatMessage from "../models/ChatMessage";
import User from "../models/User";
import { catchAsync } from "../utils/catchAsync";
import { AppError } from "../utils/AppError";
import {
    buildAlertAudienceQuery,
} from "../utils/rbac";
import {
    broadcastAlert,
    broadcastAlertRead,
    broadcastAllAlertsRead,
    broadcastAlertUpdated,
    broadcastToGroup,
} from "../websocket";
import { requireValidObjectId } from "../utils/validate";

interface AuthRequest extends Request {
    user?: any;
}

const SYSTEM_SENDER_NAME = "Hawkeye AI CCTV";
const ALERT_AUDIENCE = [
    "security_staff",
    "security_head",
    "superadmin",
    "top_management",
];

function getRecipientState(alert: any, userId: string) {
    return (alert.recipientStates || []).find(
        (state: any) => String(state.userId) === String(userId)
    );
}

function normalizeAlertForUser(alert: any, userId: string) {
    const recipientState = getRecipientState(alert, userId);

    return {
        _id: String(alert._id),
        type: alert.type,
        title: alert.title,
        message: alert.message,
        cameraSource: alert.cameraSource,
        detectionLabel: alert.detectionLabel,
        detectedObjects: Array.isArray(alert.detectedObjects)
            ? alert.detectedObjects
            : [],
        confidence: alert.confidence,
        severity: alert.severity,
        imageUrl: alert.imageUrl,
        isRead: recipientState?.isRead ?? Boolean(alert.isRead),
        readAt: recipientState?.readAt ?? alert.readAt ?? null,
        incidentStatus:
            recipientState?.incidentStatus ?? alert.incidentStatus ?? "new",
        globalIncidentStatus: alert.globalIncidentStatus || "new",
        responder: alert.responderId ? {
            _id: alert.responderId._id || alert.responderId,
            name: alert.responderId.firstName ? `${alert.responderId.firstName} ${alert.responderId.surname}` : null,
        } : null,
        resolutionNote: alert.resolutionNote || null,
        acknowledgedAt:
            recipientState?.acknowledgedAt ?? alert.acknowledgedAt ?? null,
        resolvedAt: recipientState?.resolvedAt ?? alert.resolvedAt ?? null,
        createdAt: alert.createdAt,
        updatedAt: alert.updatedAt,
    };
}

async function getAlertAudienceUsers() {
    return User.find(buildAlertAudienceQuery()).select(
        "_id role subRole staffType firstName surname",
    );
}

function buildSystemChatMessage(alert: any): string {
    return (
        `🚨 HAWKEYE ALERT [${String(alert.type || "system").toUpperCase()}] — ${alert.title}\n` +
        `Camera: ${alert.cameraSource} | Confidence: ${(Number(alert.confidence || 0) * 100).toFixed(1)}%\n` +
        `${alert.message}`
    );
}

// ─── CREATE ALERT (CCTV Webhook) ──────────────────────────────────────────────
export const createAlert = catchAsync(
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        const {
            type,
            title,
            message,
            cameraSource,
            detectionLabel,
            detectedObjects,
            confidence,
            severity,
            imageUrl,
        } = req.body;

        if (!type || !title || !message || !cameraSource || !detectionLabel || confidence === undefined || !severity) {
            return next(new AppError("Missing required fields", 400));
        }
        const incomingType = String(type);
        const incomingCameraSource = String(cameraSource);
        const incomingLabel = String(detectionLabel);
        const sixtySecondsAgo = new Date(Date.now() - 60_000);
        const existing = await Alert.findOne({
            type: incomingType,
            cameraSource: incomingCameraSource,
            detectionLabel: incomingLabel,
            createdAt: { $gte: sixtySecondsAgo },
        });

        if (existing) {
            return res.status(200).json({ deduplicated: true, alert: existing });
        }

        const audienceUsers = await User.find({ subRole: { $in: ALERT_AUDIENCE } }).select(
            "_id role subRole staffType firstName surname"
        );

        if (audienceUsers.length === 0) {
            return next(new AppError("No alert audience users configured", 400));
        }

        const alert = await Alert.create({
            type: incomingType,
            title,
            message,
            cameraSource: incomingCameraSource,
            detectionLabel: incomingLabel,
            detectedObjects: Array.isArray(detectedObjects)
                ? detectedObjects.filter(Boolean)
                : [],
            confidence,
            severity,
            imageUrl,
            audience: ALERT_AUDIENCE,
            collegeId: req.body.collegeId || null,
            globalIncidentStatus: "new",
            recipientStates: audienceUsers.map((audienceUser: any) => ({
                userId: audienceUser._id,
                isRead: false,
                incidentStatus: "new",
            })),
        });

        for (const audienceUser of audienceUsers) {
            broadcastAlert(
                normalizeAlertForUser(alert, String(audienceUser._id)),
                String(audienceUser._id),
            );
        }

        const chatMessage = await ChatMessage.create({
            groupId: "security_general",
            senderId: null,
            senderName: SYSTEM_SENDER_NAME,
            senderRole: "System",
            message: buildSystemChatMessage(alert),
            isSystemMessage: true,
            mentions: [],
            readBy: [],
            threadId: null,
            replyTo: null,
        });

        broadcastToGroup("security_general", {
            type: "NEW_CHAT_MESSAGE",
            event: "NEW_CHAT_MESSAGE",
            message: {
                _id: String(chatMessage._id),
                senderId: null,
                senderName: chatMessage.senderName,
                senderRole: chatMessage.senderRole,
                recipientId: null,
                groupId: chatMessage.groupId,
                message: chatMessage.message,
                replyTo: null,
                isSystemMessage: true,
                mentions: [],
                threadId: null,
                isRead: false,
                readBy: [],
                createdAt: chatMessage.createdAt,
            },
        });

        res.status(201).json({
            status: "success",
            data: alert,
        });
    }
);

// ─── UPDATE INCIDENT STATUS ──────────────────────────────────────────────────
export const updateIncidentStatus = catchAsync(
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        const { id } = req.params;
        const { incidentStatus } = req.body;

        if (!requireValidObjectId(id, res)) return;

        const allowedStatuses = ["new", "acknowledged", "in_progress", "resolved"];
        if (!allowedStatuses.includes(incidentStatus)) {
            return next(new AppError("Invalid incident status", 400));
        }

        const recipientQuery = {
            _id: id,
            "recipientStates.userId": req.user._id,
        };
        const updateSet: Record<string, any> = {
            "recipientStates.$[recipient].incidentStatus": incidentStatus,
        };
        const updateUnset: Record<string, any> = {};

        if (incidentStatus === "acknowledged" || incidentStatus === "in_progress") {
            updateSet["recipientStates.$[recipient].acknowledgedBy"] = req.user._id;
            updateSet["recipientStates.$[recipient].acknowledgedAt"] = new Date();
        }

        if (incidentStatus === "resolved") {
            updateSet["recipientStates.$[recipient].resolvedBy"] = req.user._id;
            updateSet["recipientStates.$[recipient].resolvedAt"] = new Date();
            updateSet["recipientStates.$[recipient].acknowledgedBy"] = req.user._id;
            updateSet["recipientStates.$[recipient].acknowledgedAt"] = new Date();
        }

        if (incidentStatus === "new") {
            updateUnset["recipientStates.$[recipient].acknowledgedBy"] = "";
            updateUnset["recipientStates.$[recipient].acknowledgedAt"] = "";
            updateUnset["recipientStates.$[recipient].resolvedBy"] = "";
            updateUnset["recipientStates.$[recipient].resolvedAt"] = "";
        }

        const alert = await Alert.findOneAndUpdate(
            recipientQuery,
            {
                $set: updateSet,
                ...(Object.keys(updateUnset).length > 0 ? { $unset: updateUnset } : {}),
            },
            {
                new: true,
                arrayFilters: [{ "recipient.userId": req.user._id }],
            }
        );

        if (!alert) {
            return next(new AppError("Alert not found", 404));
        }

        const normalizedAlert = normalizeAlertForUser(alert, String(req.user._id));
        broadcastAlertUpdated(normalizedAlert, String(req.user._id));

        res.status(200).json({
            status: "success",
            data: normalizedAlert,
        });
    }
);

// ─── ACKNOWLEDGE ALERT (Global) ───────────────────────────────────────────────
export const acknowledgeAlert = catchAsync(
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        const { id } = req.params;

        if (!requireValidObjectId(id, res)) return;

        const alert = await Alert.findByIdAndUpdate(
            id,
            {
                $set: {
                    globalIncidentStatus: "acknowledged",
                    responderId: req.user._id,
                },
            },
            { new: true }
        ).populate("responderId", "firstName surname");

        if (!alert) return next(new AppError("Alert not found", 404));

        const normalizedAlert = normalizeAlertForUser(alert, String(req.user._id));
        broadcastAlertUpdated(normalizedAlert); // Global broadcast

        res.status(200).json({
            status: "success",
            data: normalizedAlert,
        });
    }
);

// ─── RESOLVE ALERT (Global) ───────────────────────────────────────────────────
export const resolveAlert = catchAsync(
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        const { id } = req.params;
        const { resolutionNote } = req.body;

        if (!requireValidObjectId(id, res)) return;

        if (!resolutionNote) {
            return next(new AppError("Resolution note is required", 400));
        }

        const alert = await Alert.findByIdAndUpdate(
            id,
            {
                $set: {
                    globalIncidentStatus: "resolved",
                    responderId: req.user._id,
                    resolutionNote,
                },
            },
            { new: true }
        ).populate("responderId", "firstName surname");

        if (!alert) return next(new AppError("Alert not found", 404));

        const normalizedAlert = normalizeAlertForUser(alert, String(req.user._id));
        broadcastAlertUpdated(normalizedAlert); // Global broadcast

        res.status(200).json({
            status: "success",
            data: normalizedAlert,
        });
    }
);

// ─── GET ALL ALERTS ───────────────────────────────────────────────────────────
export const getAlerts = catchAsync(
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 20;
        const skip = (page - 1) * limit;

        const userId = String(req.user._id);
        const filter: any = {};
        
        // Scope alerts by audience array for non-superadmins
        if (req.user.subRole !== "superadmin") {
            filter.audience = { $in: [req.user.subRole] };
        }

        if (req.query.type) filter.type = req.query.type;
        if (req.query.severity) filter.severity = req.query.severity;

        const alerts = await Alert.find(filter)
            .sort({ createdAt: -1 })
            .populate("responderId", "firstName surname");

        const normalizedAlerts = alerts
            .map((alert: any) => normalizeAlertForUser(alert, userId))
            .filter((alert: any) => {
                if (req.query.isRead === "true") return alert.isRead === true;
                if (req.query.isRead === "false") return alert.isRead === false;
                return true;
            });

        const total = normalizedAlerts.length;
        const paginatedAlerts = normalizedAlerts.slice(skip, skip + limit);

        res.status(200).json({
            status: "success",
            data: paginatedAlerts,
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
        const count = await Alert.countDocuments({
            recipientStates: {
                $elemMatch: {
                    userId: req.user._id,
                    isRead: false,
                },
            },
        });

        res.status(200).json({
            status: "success",
            data: { count },
        });
    }
);

// ─── MARK ALERT AS READ ───────────────────────────────────────────────────────
export const markAsRead = catchAsync(
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        const { id } = req.params;

        if (!requireValidObjectId(id, res)) return;

        const alert = await Alert.findOneAndUpdate(
            {
                _id: id,
                "recipientStates.userId": req.user._id,
            },
            {
                $set: {
                    "recipientStates.$[recipient].isRead": true,
                    "recipientStates.$[recipient].readAt": new Date(),
                },
            },
            {
                new: true,
                arrayFilters: [{ "recipient.userId": req.user._id }],
            }
        );

        if (!alert) {
            return next(new AppError("Alert not found", 404));
        }

        broadcastAlertRead(String(alert._id), String(req.user._id));

        res.status(200).json({
            status: "success",
            data: normalizeAlertForUser(alert, String(req.user._id)),
        });
    }
);

// ─── MARK ALL ALERTS AS READ ──────────────────────────────────────────────────
export const markAllAsRead = catchAsync(
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        await Alert.updateMany(
            {
                "recipientStates.userId": req.user._id,
                "recipientStates.isRead": false,
            },
            {
                $set: {
                    "recipientStates.$[recipient].isRead": true,
                    "recipientStates.$[recipient].readAt": new Date(),
                },
            }
            ,
            {
                arrayFilters: [{ "recipient.userId": req.user._id }],
            }
        );

        broadcastAllAlertsRead(String(req.user._id));

        res.status(200).json({
            status: "success",
            message: "All alerts marked as read",
        });
    }
);

// ─── DELETE ALERT ─────────────────────────────────────────────────────────────
export const deleteAlert = catchAsync(
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        const { id } = req.params;

        if (!requireValidObjectId(id, res)) return;

        const alert = await Alert.findByIdAndDelete(id);

        if (!alert) {
            return next(new AppError("Alert not found", 404));
        }

        res.status(200).json({
            status: "success",
            message: "Alert deleted",
        });
    }
);
