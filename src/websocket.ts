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

const connectedClients = new Map<string, AuthenticatedWebSocket>();

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

            ws.userId = decoded.userId;
            ws.userRole = decoded.role;
            ws.userName = decoded.name || "Unknown";

            // Store connection
            if (ws.userId) {
                connectedClients.set(ws.userId, ws);
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
                    connectedClients.delete(ws.userId);
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
    const chatMessage = new ChatMessage({
        sender: ws.userId,
        senderName: ws.userName,
        senderRole: ws.userRole,
        content: message.content,
        recipient: message.recipientId || null,
        isGroupMessage: !message.recipientId,
    });

    await chatMessage.save();

    // Broadcast to all connected clients (or specific recipient)
    const broadcastMessage = {
        type: "NEW_CHAT_MESSAGE",
        message: {
            _id: chatMessage._id,
            sender: chatMessage.sender,
            senderName: chatMessage.senderName,
            senderRole: chatMessage.senderRole,
            content: chatMessage.content,
            recipient: chatMessage.recipient,
            isGroupMessage: chatMessage.isGroupMessage,
            createdAt: chatMessage.createdAt,
        },
    };

    if (message.recipientId) {
        // Send to specific recipient and sender
        const recipientWs = connectedClients.get(message.recipientId);
        if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
            recipientWs.send(JSON.stringify(broadcastMessage));
        }
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(broadcastMessage));
        }
    } else {
        // Broadcast to all connected clients
        connectedClients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(broadcastMessage));
            }
        });
    }
}

async function handleMarkAlertRead(
    ws: AuthenticatedWebSocket,
    message: any
) {
    if (!ws.userId || !message.alertId) {
        return;
    }

    await Alert.findByIdAndUpdate(message.alertId, {
        $addToSet: { readBy: ws.userId },
    });

    // Broadcast read status to all clients
    const broadcastMessage = {
        type: "ALERT_READ",
        alertId: message.alertId,
        userId: ws.userId,
    };

    connectedClients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(broadcastMessage));
        }
    });
}

async function handleMarkChatRead(
    ws: AuthenticatedWebSocket,
    message: any
) {
    if (!ws.userId || !message.messageId) {
        return;
    }

    await ChatMessage.findByIdAndUpdate(message.messageId, {
        $addToSet: { readBy: ws.userId },
    });
}

// Export function to broadcast alerts to all connected clients
export function broadcastAlert(alert: any) {
    const message = {
        type: "NEW_ALERT",
        alert,
    };

    connectedClients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    });
}

// Export function to get connected clients count
export function getConnectedClientsCount(): number {
    return connectedClients.size;
}
