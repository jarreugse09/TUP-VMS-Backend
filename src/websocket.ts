import { WebSocketServer, WebSocket } from "ws";
import { Server } from "http";
import jwt from "jsonwebtoken";
import Alert from "./models/Alert";
import ChatMessage from "./models/ChatMessage";

interface AuthenticatedWebSocket extends WebSocket {
    userId?: string;
    userRole?: string;
    userName?: string;
}

const connectedClients = new Map<string, Set<AuthenticatedWebSocket>>();

function addClientConnection(userId: string, ws: AuthenticatedWebSocket) {
    const existing = connectedClients.get(userId) || new Set<AuthenticatedWebSocket>();
    existing.add(ws);
    connectedClients.set(userId, existing);
}

function removeClientConnection(userId: string, ws: AuthenticatedWebSocket) {
    const existing = connectedClients.get(userId);
    if (!existing) return;
    existing.delete(ws);
    if (existing.size === 0) {
        connectedClients.delete(userId);
    }
}

function sendToUser(userId: string, payload: unknown) {
    const sockets = connectedClients.get(userId);
    if (!sockets) return;
    const serialized = JSON.stringify(payload);
    sockets.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(serialized);
        }
    });
}

function sendToUsers(userIds: string[], payload: unknown) {
    userIds.forEach((userId) => sendToUser(userId, payload));
}

function broadcast(payload: unknown) {
    const serialized = JSON.stringify(payload);
    connectedClients.forEach((sockets) => {
        sockets.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(serialized);
            }
        });
    });
}

export function setupWebSocket(server: Server) {
    const wss = new WebSocketServer({ server });

    wss.on("connection", (ws: AuthenticatedWebSocket, req) => {
        console.log("New WebSocket connection");

        // Extract token from query string
        const url = new URL(req.url || "", `http://${req.headers.host}`);
        const token = url.searchParams.get("token");

        if (!token) {
            ws.close(1008, "Authentication required");
            return;
        }

        try {
            // Verify JWT token
            const decoded = jwt.verify(
                token,
                process.env.JWT_SECRET || "your-secret-key"
            ) as any;

            ws.userId = decoded.id || decoded.userId;
            ws.userRole =
                decoded.role === "Staff" && decoded.staffType === "Security"
                    ? "Security"
                    : decoded.role;
            ws.userName = decoded.name || "Unknown";

            // Store connection
            if (ws.userId) {
                addClientConnection(ws.userId, ws);
                console.log(`User ${ws.userName} (${ws.userId}) connected via WebSocket`);
            }

            // Send connection confirmation
            ws.send(
                JSON.stringify({
                    type: "CONNECTED",
                    message: "WebSocket connection established",
                    userId: ws.userId,
                })
            );

            // Handle incoming messages
            ws.on("message", async (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    await handleMessage(ws, message);
                } catch (error) {
                    console.error("Error handling WebSocket message:", error);
                    ws.send(
                        JSON.stringify({
                            type: "ERROR",
                            message: "Invalid message format",
                        })
                    );
                }
            });

            // Handle disconnection
            ws.on("close", () => {
                if (ws.userId) {
                    removeClientConnection(ws.userId, ws);
                    console.log(`User ${ws.userName} (${ws.userId}) disconnected`);
                }
            });

            ws.on("error", (error) => {
                console.error("WebSocket error:", error);
            });
        } catch (error) {
            console.error("WebSocket authentication failed:", error);
            ws.close(1008, "Invalid token");
        }
    });

    return wss;
}

async function handleMessage(ws: AuthenticatedWebSocket, message: any) {
    switch (message.type) {
        case "SEND_CHAT_MESSAGE":
            await handleChatMessage(ws, message);
            break;

        case "MARK_ALERT_READ":
            await handleMarkAlertRead(ws, message);
            break;

        case "MARK_CHAT_READ":
            await handleMarkChatRead(ws, message);
            break;

        case "PING":
            ws.send(JSON.stringify({ type: "PONG" }));
            break;

        default:
            ws.send(
                JSON.stringify({
                    type: "ERROR",
                    message: `Unknown message type: ${message.type}`,
                })
            );
    }
}

async function handleChatMessage(
    ws: AuthenticatedWebSocket,
    message: any
) {
    if (!ws.userId || !message.content) {
        ws.send(
            JSON.stringify({
                type: "ERROR",
                message: "Invalid chat message",
            })
        );
        return;
    }

    // Save message to database
    const chatMessage = await ChatMessage.create({
        senderId: ws.userId,
        senderName: ws.userName,
        senderRole: ws.userRole,
        recipientId: message.recipientId || null,
        message: message.content,
    });

    // Broadcast to all connected clients (or specific recipient)
    const broadcastMessage = buildChatBroadcastMessage(chatMessage);

    if (message.recipientId) {
        // Send to specific recipient and sender
        sendToUser(message.recipientId, broadcastMessage);
        if (ws.userId) {
            sendToUser(ws.userId, broadcastMessage);
        }
    } else {
        // Broadcast to all connected clients
        broadcast(broadcastMessage);
    }
}

async function handleMarkAlertRead(
    ws: AuthenticatedWebSocket,
    message: any
) {
    if (!ws.userId || !message.alertId) {
        return;
    }

    await Alert.findOneAndUpdate(
        {
            _id: message.alertId,
            "recipientStates.userId": ws.userId,
        },
        {
            $set: {
                "recipientStates.$[recipient].isRead": true,
                "recipientStates.$[recipient].readAt": new Date(),
            },
        },
        {
            arrayFilters: [{ "recipient.userId": ws.userId }],
        }
    );

    sendToUser(
        ws.userId,
        {
            type: "ALERT_READ",
            alertId: message.alertId,
            userId: ws.userId,
        }
    );
}

async function handleMarkChatRead(
    ws: AuthenticatedWebSocket,
    message: any
) {
    if (!ws.userId || !message.messageId) {
        return;
    }

    await ChatMessage.findOneAndUpdate(
        {
            _id: message.messageId,
            recipientId: ws.userId,
        },
        {
            isRead: true,
            readAt: new Date(),
        }
    );
}

export function broadcastAlert(alert: any, userId?: string) {
    const message = {
        type: "NEW_ALERT",
        alert,
    };

    if (userId) {
        sendToUser(userId, message);
        return;
    }

    broadcast(message);
}

export function broadcastAlertRead(alertId: string, userId?: string) {
    const message = {
        type: "ALERT_READ",
        alertId,
        userId: userId || null,
    };

    if (userId) {
        sendToUser(userId, message);
        return;
    }

    broadcast(message);
}

export function broadcastAllAlertsRead(userId?: string) {
    const message = {
        type: "ALL_ALERTS_READ",
        userId: userId || null,
    };

    if (userId) {
        sendToUser(userId, message);
        return;
    }

    broadcast(message);
}

export function broadcastAlertUpdated(alert: any, userId?: string) {
    const message = {
        type: "ALERT_UPDATED",
        alert,
    };

    if (userId) {
        sendToUser(userId, message);
        return;
    }

    broadcast(message);
}

function buildChatBroadcastMessage(chatMessage: any) {
    return {
        type: "NEW_CHAT_MESSAGE",
        message: {
            _id: String(chatMessage._id),
            senderId: chatMessage.senderId ? String(chatMessage.senderId) : null,
            senderName: chatMessage.senderName,
            senderRole: chatMessage.senderRole,
            recipientId: chatMessage.recipientId ? String(chatMessage.recipientId) : null,
            message: chatMessage.message,
            isRead: Boolean(chatMessage.isRead),
            createdAt: chatMessage.createdAt,
        },
    };
}

export function broadcastChatMessage(chatMessage: any, recipientUserIds?: string[]) {
    const message = buildChatBroadcastMessage(chatMessage);

    if (recipientUserIds && recipientUserIds.length > 0) {
        sendToUsers(recipientUserIds, message);
        return;
    }

    if (chatMessage.recipientId) {
        const recipientId = String(chatMessage.recipientId);
        sendToUsers([recipientId], message);
        return;
    }

    broadcast(message);
}

// Export function to get connected clients count
export function getConnectedClientsCount(): number {
    let total = 0;
    connectedClients.forEach((sockets) => {
        total += sockets.size;
    });
    return total;
}
