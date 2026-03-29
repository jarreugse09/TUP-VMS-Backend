import { Request, Response, type NextFunction } from "express";
import Alert from "../models/Alert";
import { catchAsync } from "../utils/catchAsync";
import { AppError } from "../utils/AppError";
import { broadcastAlert } from "../websocket";

interface AuthRequest extends Request {
    user?: any;
}

// ─── CREATE ALERT (CCTV Webhook) ──────────────────────────────────────────────
export const createAlert = catchAsync(
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        const { type, title, message, cameraSource, detectionLabel, confidence, severity, imageUrl } = req.body;

        if (!type || !title || !message || !cameraSource || !detectionLabel || confidence === undefined || !severity) {
            return next(new AppError("Missing required fields", 400));
        }

        const alert = await Alert.create({
            type,
            title,
            message,
            cameraSource,
            detectionLabel,
            confidence,
            severity,
            imageUrl,
        });

        // Broadcast alert to all connected WebSocket clients
        broadcastAlert(alert);

        res.status(201).json({
            status: "success",
            data: alert,
        });
    }
);

// ─── GET ALL ALERTS ───────────────────────────────────────────────────────────
export const getAlerts = catchAsync(
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 20;
        const skip = (page - 1) * limit;

        const filter: any = {};

        if (req.query.type) filter.type = req.query.type;
        if (req.query.severity) filter.severity = req.query.severity;
        if (req.query.isRead !== undefined) filter.isRead = req.query.isRead === "true";

        const alerts = await Alert.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate("readBy", "firstName surname");

        const total = await Alert.countDocuments(filter);

        res.status(200).json({
            status: "success",
            data: alerts,
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
        const count = await Alert.countDocuments({ isRead: false });

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

        const alert = await Alert.findByIdAndUpdate(
            id,
            {
                isRead: true,
                readBy: req.user._id,
                readAt: new Date(),
            },
            { new: true }
        );

        if (!alert) {
            return next(new AppError("Alert not found", 404));
        }

        res.status(200).json({
            status: "success",
            data: alert,
        });
    }
);

// ─── MARK ALL ALERTS AS READ ──────────────────────────────────────────────────
export const markAllAsRead = catchAsync(
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        await Alert.updateMany(
            { isRead: false },
            {
                isRead: true,
                readBy: req.user._id,
                readAt: new Date(),
            }
        );

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
