// backend/src/utils/socket.js
import { Server } from "socket.io";

let io;

// userId (string) → Set<socketId>   (handles multiple tabs per user)
const onlineUsers = new Map();

// ─── Initialize ───────────────────────────────────────────────────────────────
export const initializeSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin:      process.env.FRONTEND_URL || "http://localhost:3000",
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    const userId = socket.handshake.query.userId;

    // ── Register presence ──────────────────────────────────────────────────
    if (userId) {
      if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
      onlineUsers.get(userId).add(socket.id);
      io.emit("onlineUsers", Array.from(onlineUsers.keys()));
      console.log(`🟢 Connected  user=${userId}  socket=${socket.id}`);
    }

    // ── Rooms ──────────────────────────────────────────────────────────────
    // Personal room for notifications
    socket.on("joinRoom", (uid) => socket.join(`user:${uid}`));

    // Conversation rooms for chat
    socket.on("joinConversation",  (cid) => socket.join(`conversation:${cid}`));
    socket.on("leaveConversation", (cid) => socket.leave(`conversation:${cid}`));

    // ── Typing indicators ──────────────────────────────────────────────────
    socket.on("typing", ({ conversationId, senderId }) => {
      socket.to(`conversation:${conversationId}`).emit("typing", { senderId });
    });

    socket.on("stopTyping", ({ conversationId, senderId }) => {
      socket.to(`conversation:${conversationId}`).emit("stopTyping", { senderId });
    });

    // ── Video / audio call signaling ───────────────────────────────────────
    socket.on("callUser", ({ to, from, signal, callerName, callType = "video" }) => {
      _emitToUser(to, "incomingCall", { from, signal, callerName, callType });
    });

    socket.on("answerCall", ({ to, signal }) => {
      _emitToUser(to, "callAccepted", signal);
    });

    socket.on("rejectCall", ({ to }) => {
      _emitToUser(to, "callRejected");
    });

    socket.on("endCall", ({ to }) => {
      _emitToUser(to, "callEnded");
    });

    socket.on("iceCandidate", ({ to, candidate }) => {
      _emitToUser(to, "iceCandidate", { candidate });
    });

    // ── Disconnect ─────────────────────────────────────────────────────────
    socket.on("disconnect", () => {
      if (userId && onlineUsers.has(userId)) {
        onlineUsers.get(userId).delete(socket.id);
        if (onlineUsers.get(userId).size === 0) onlineUsers.delete(userId);
        io.emit("onlineUsers", Array.from(onlineUsers.keys()));
        console.log(`🔴 Disconnected  user=${userId}`);
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

// ─── Public helpers (used by controllers) ────────────────────────────────────

/** Emit a notification to a user's personal room (joined on login) */
export const emitNotification = (userId, notification) => {
  if (io) io.to(`user:${userId}`).emit("newNotification", notification);
};

/** Emit any event to a conversation room */
export const emitToRoom = (room, event, data) => {
  if (io) io.to(room).emit(event, data);
};

/** Emit any event directly to all sockets of a specific user */
export const emitToUser = (userId, event, data) => _emitToUser(userId, event, data);

/** Getters */
export const getIO          = ()       => io;
export const getOnlineUsers = ()       => Array.from(onlineUsers.keys());
export const isUserOnline   = (userId) => onlineUsers.has(userId?.toString());