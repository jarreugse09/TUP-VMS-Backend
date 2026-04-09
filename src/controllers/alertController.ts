import { Request, Response, type NextFunction } from "express";
import Alert from "../models/Alert";
import ChatMessage from "../models/ChatMessage";
import User from "../models/User";
import { catchAsync } from "../utils/catchAsync";
import { AppError } from "../utils/AppError";
import {
    buildAlertAudienceQuery,
    buildSecurityAudienceQuery,
} from "../utils/rbac";
import {
    broadcastAlert,
    broadcastAlertRead,
    broadcastAllAlertsRead,
    broadcastAlertUpdated,
    broadcastChatMessage,
} from "../websocket";

interface AuthRequest extends Request {
    user?: any;
}

const SYSTEM_SENDER_NAME = "Hawkeye AI CCTV";

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

async function getSecurityUsers() {
    return User.find(buildSecurityAudienceQuery()).select("_id firstName surname");
}

function buildSystemChatMessage(alert: any): string {
    const confidencePct = Number(alert.confidence || 0) * 100;
    const detectedObjects = Array.isArray(alert.detectedObjects)
        ? alert.detectedObjects.filter(Boolean)
        : [];

    return [
        `[${String(alert.type || "system").toUpperCase()}] ${alert.title}`,
        alert.message,
        `Source: ${alert.cameraSource}`,
        `Label: ${alert.detectionLabel}`,
        detectedObjects.length > 0
            ? `Detected Objects: ${detectedObjects.join(", ")}`
            : null,
        `Confidence: ${confidencePct.toFixed(1)}%`,
        `Severity: ${String(alert.severity || "").toUpperCase()}`,
    ].filter(Boolean).join("\n");
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

        const audienceUsers = await getAlertAudienceUsers();
        if (audienceUsers.length === 0) {
            return next(new AppError("No alert audience users configured", 400));
        }

        const alert = await Alert.create({
            type,
            title,
            message,
            cameraSource,
            detectionLabel,
            detectedObjects: Array.isArray(detectedObjects)
                ? detectedObjects.filter(Boolean)
                : [],
            confidence,
            severity,
            imageUrl,
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

        if (type === "weapon" || type === "suspicious") {
            const securityUsers = await getSecurityUsers();
            const systemMessageBody = buildSystemChatMessage(alert);

            for (const securityUser of securityUsers) {
                const chatMessage = await ChatMessage.create({
                    senderName: SYSTEM_SENDER_NAME,
                    senderRole: "System",
                    recipientId: securityUser._id,
                    message: systemMessageBody,
                });

                broadcastChatMessage(chatMessage, [String(securityUser._id)]);
            }
        }

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

// ─── GET ALL ALERTS ───────────────────────────────────────────────────────────
export const getAlerts = catchAsync(
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 20;
        const skip = (page - 1) * limit;

        const userId = String(req.user._id);
        const filter: any = {
            $or: [
                { "recipientStates.userId": req.user._id },
                { recipientStates: { $exists: false } },
                { recipientStates: { $size: 0 } },
            ],
        };

        if (req.query.type) filter.type = req.query.type;
        if (req.query.severity) filter.severity = req.query.severity;

        const alerts = await Alert.find(filter)
            .sort({ createdAt: -1 });

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
