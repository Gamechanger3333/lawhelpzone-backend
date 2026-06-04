// backend/src/utils/socket.js
import { Server } from "socket.io";
import jwt        from "jsonwebtoken";

let io;

// userId (string) → Set<socketId>  (handles multiple tabs per user)
const onlineUsers = new Map();

// ─── Initialize ───────────────────────────────────────────────────────────────
export const initializeSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin:      process.env.FRONTEND_URL || "http://localhost:3000",
      credentials: true,
    },
  });

  // ── Auth middleware — verify JWT before any event is handled ────────────────
  io.use((socket, next) => {
    try {
      // Accept token from auth object (preferred) or query string (fallback)
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error("Authentication required"));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id?.toString();
      if (!socket.userId) return next(new Error("Invalid token payload"));

      next();
    } catch {
      next(new Error("Authentication failed"));
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.userId;

    // ── Register presence ────────────────────────────────────────────────────
    if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
    onlineUsers.get(userId).add(socket.id);
    io.emit("onlineUsers", Array.from(onlineUsers.keys()));

    // ── Personal notification room ────────────────────────────────────────────
    socket.join(`user_${userId}`);

    // ── Typing indicators ─────────────────────────────────────────────────────
    socket.on("typing", ({ conversationId, senderId }) => {
      socket.to(`conversation:${conversationId}`).emit("typing", { senderId });
    });

    socket.on("stopTyping", ({ conversationId, senderId }) => {
      socket.to(`conversation:${conversationId}`).emit("stopTyping", { senderId });
    });

    // ── Video / audio call signaling ──────────────────────────────────────────
    socket.on("callUser",     ({ to, from, signal, callerName, callType = "video" }) => _emitToUser(to, "incomingCall", { from, signal, callerName, callType }));
    socket.on("answerCall",   ({ to, signal })   => _emitToUser(to, "callAccepted", signal));
    socket.on("rejectCall",   ({ to })           => _emitToUser(to, "callRejected"));
    socket.on("endCall",      ({ to })           => _emitToUser(to, "callEnded"));
    socket.on("iceCandidate", ({ to, candidate }) => _emitToUser(to, "iceCandidate", { candidate }));

    // ── Disconnect ────────────────────────────────────────────────────────────
    socket.on("disconnect", () => {
      if (onlineUsers.has(userId)) {
        onlineUsers.get(userId).delete(socket.id);
        if (onlineUsers.get(userId).size === 0) onlineUsers.delete(userId);
        io.emit("onlineUsers", Array.from(onlineUsers.keys()));
      }
    });
  });

  return io;
};

// ─── Private helper ───────────────────────────────────────────────────────────
const _emitToUser = (userId, event, data) => {
  if (!io) return;
  const sockets = onlineUsers.get(userId?.toString());
  if (sockets) sockets.forEach((sid) => io.to(sid).emit(event, data));
};

// ─── Public helpers (used by controllers & notificationService) ───────────────

/** Emit a notification to a user's personal room */
export const emitNotification = (userId, notification) => {
  if (io) io.to(`user_${userId}`).emit("newNotification", notification);
};

/** Emit any event to a conversation room */
export const emitToRoom = (room, event, data) => {
  if (io) io.to(room).emit(event, data);
};

/** Emit any event directly to all sockets of a specific user */
export const emitToUser = (userId, event, data) => _emitToUser(userId, event, data);

export const getIO          = ()       => io;
export const getOnlineUsers = ()       => Array.from(onlineUsers.keys());
export const isUserOnline   = (userId) => onlineUsers.has(userId?.toString());