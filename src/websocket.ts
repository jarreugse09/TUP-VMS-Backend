import { WebSocketServer, WebSocket } from "ws";
import { Server } from "http";
import jwt from "jsonwebtoken";
import Alert from "./models/Alert";
import ChatMessage from "./models/ChatMessage";
import type { JwtPayload } from "jsonwebtoken";

type SocketMessage =
    | {
          type: "SEND_CHAT_MESSAGE";
          content?: string;
          recipientId?: string | null;
          replyTo?: string;
          isSystemMessage?: boolean;
          mentions?: string[];
          threadId?: string;
      }
    | {
          type: "MARK_ALERT_READ";
          alertId?: string;
      }
    | {
          type: "MARK_CHAT_READ";
          messageId?: string;
      }
    | {
          type: "PING";
      };

interface TokenPayload extends JwtPayload {
    id?: string;
    userId?: string;
    role?: string;
    staffType?: string;
    subRole?: string;
    name?: string;
}

interface AlertSocketPayload {
    _id?: string;
    recipientStates?: Array<{
        userId: string;
        isRead?: boolean;
        readAt?: Date | null;
    }>;
    [key: string]: unknown;
}

interface ChatSocketPayload {
    _id?: string | { toString(): string };
    senderId?: string | { toString(): string } | null;
    senderName?: string;
    senderRole?: string;
    recipientId?: string | { toString(): string } | null;
    message?: string;
    replyTo?: string | { toString(): string } | null;
    isSystemMessage?: boolean;
    mentions?: Array<string | { toString(): string }>;
    threadId?: string | { toString(): string } | null;
    isRead?: boolean;
    createdAt?: Date;
    groupId?: string;
}

interface AuthenticatedWebSocket extends WebSocket {
    userId?: string;
    userRole?: string;
    userSubRole?: string;
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
                process.env.JWT_SECRET!
            ) as TokenPayload;

            ws.userId = decoded.id || decoded.userId;
            ws.userRole =
                decoded.role === "Staff" && decoded.staffType === "Security"
                    ? "Security"
                    : decoded.role;
            ws.userSubRole = decoded.subRole;
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

async function handleMessage(ws: AuthenticatedWebSocket, message: SocketMessage) {
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

        default: {
            const unknownMessage = message as { type?: string };
            ws.send(
                JSON.stringify({
                    type: "ERROR",
                    message: `Unknown message type: ${unknownMessage.type}`,
                })
            );
        }
    }
}

async function handleChatMessage(
    ws: AuthenticatedWebSocket,
    message: Extract<SocketMessage, { type: "SEND_CHAT_MESSAGE" }>
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
        replyTo: message.replyTo || undefined,
        isSystemMessage: message.isSystemMessage || false,
        mentions: Array.isArray(message.mentions) ? message.mentions : undefined,
        threadId: message.threadId || undefined,
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
    message: Extract<SocketMessage, { type: "MARK_ALERT_READ" }>
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
    message: Extract<SocketMessage, { type: "MARK_CHAT_READ" }>
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

export function broadcastAlert(alert: AlertSocketPayload, userId?: string) {
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

export function broadcastAlertUpdated(alert: AlertSocketPayload, userId?: string) {
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

const SECURITY_GROUP_SUBROLES = new Set([
    "security_staff",
    "security_head",
    "superadmin",
    "top_management",
]);

export function broadcastToGroup(groupId: string, payload: Record<string, unknown>) {
    const serialized = JSON.stringify(payload);

    connectedClients.forEach((sockets) => {
        sockets.forEach((client) => {
            const normalizedSubRole = String(client.userSubRole || "").toLowerCase();
            const isSecurityGeneralAudience =
                groupId === "security_general" &&
                SECURITY_GROUP_SUBROLES.has(normalizedSubRole);

            if (client.readyState === WebSocket.OPEN && isSecurityGeneralAudience) {
                client.send(serialized);
            }
        });
    });
}

function buildChatBroadcastMessage(chatMessage: ChatSocketPayload) {
    return {
        type: "NEW_CHAT_MESSAGE",
        message: {
            _id: String(chatMessage._id),
            senderId: chatMessage.senderId ? String(chatMessage.senderId) : null,
            senderName: chatMessage.senderName,
            senderRole: chatMessage.senderRole,
            recipientId: chatMessage.recipientId ? String(chatMessage.recipientId) : null,
            message: chatMessage.message,
            replyTo: chatMessage.replyTo ? String(chatMessage.replyTo) : undefined,
            isSystemMessage: Boolean(chatMessage.isSystemMessage),
            mentions: Array.isArray(chatMessage.mentions) ? chatMessage.mentions.map((id) => String(id)) : undefined,
            threadId: chatMessage.threadId ? String(chatMessage.threadId) : undefined,
            isRead: Boolean(chatMessage.isRead),
            createdAt: chatMessage.createdAt,
        },
    };
}

export function broadcastChatMessage(chatMessage: ChatSocketPayload, recipientUserIds?: string[]) {
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

    if (chatMessage.groupId === "security_general" || chatMessage.senderRole === "System") {
        broadcastToGroup("security_general", message);
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
