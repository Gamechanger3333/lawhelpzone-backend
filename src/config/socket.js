/ backend/src/config/socket.js
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import User from "../models/User.js";

export const initializeSocket = (server) => {
  const io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL || "http://localhost:3000",
      credentials: true
    }
  });

  // Authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) throw new Error("Authentication required");

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id);
      
      if (!user) throw new Error("User not found");
      
      socket.userId = user._id.toString();
      socket.userRole = user.role;
      next();
    } catch (error) {
      next(new Error("Authentication failed"));
    }
  });

  io.on("connection", async (socket) => {
    console.log(`User connected: ${socket.userId}`);

    // Update user online status
    await User.findByIdAndUpdate(socket.userId, {
      isOnline: true,
      socketId: socket.id,
      lastSeen: new Date()
    });

    // Join user's personal room
    socket.join(`user:${socket.userId}`);

    // Handle joining conversation rooms
    socket.on("join_conversation", (conversationId) => {
      socket.join(`conversation:${conversationId}`);
    });

    // Handle leaving conversation rooms
    socket.on("leave_conversation", (conversationId) => {
      socket.leave(`conversation:${conversationId}`);
    });

    // Handle new messages
    socket.on("send_message", async (data) => {
      const { conversationId, content, messageType } = data;
      
      // Save message to database
      const message = await Message.create({
        conversation: conversationId,
        sender: socket.userId,
        content,
        messageType: messageType || "text"
      });

      await message.populate("sender", "name profileImage");

      // Update conversation
      await Conversation.findByIdAndUpdate(conversationId, {
        lastMessage: message._id,
        $inc: { [`unreadCount.${message.sender}`]: 1 }
      });

      // Emit to all participants in the conversation
      io.to(`conversation:${conversationId}`).emit("new_message", message);
    });

    // Handle typing indicators
    socket.on("typing_start", ({ conversationId }) => {
      socket.to(`conversation:${conversationId}`).emit("user_typing", {
        userId: socket.userId,
        conversationId
      });
    });

    socket.on("typing_stop", ({ conversationId }) => {
      socket.to(`conversation:${conversationId}`).emit("user_stopped_typing", {
        userId: socket.userId,
        conversationId
      });
    });

    // Handle message read receipts
    socket.on("mark_read", async ({ conversationId, messageIds }) => {
      await Message.updateMany(
        { _id: { $in: messageIds } },
        { $addToSet: { readBy: { user: socket.userId } } }
      );

      socket.to(`conversation:${conversationId}`).emit("messages_read", {
        userId: socket.userId,
        messageIds
      });
    });

    // Handle disconnect
    socket.on("disconnect", async () => {
      console.log(`User disconnected: ${socket.userId}`);
      await User.findByIdAndUpdate(socket.userId, {
        isOnline: false,
        lastSeen: new Date(),
        $unset: { socketId: 1 }
      });

      io.emit("user_offline", socket.userId);
    });
  });

  return io;
};