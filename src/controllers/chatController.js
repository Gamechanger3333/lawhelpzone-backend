// backend/src/controllers/chatController.js
import Message      from "../models/Message.js";
import User         from "../models/User.js";
import Notification from "../models/Notification.js";
import mongoose     from "mongoose";

// Safely convert any value to ObjectId — avoids cast errors
const toObjId = (v) => {
  try { return new mongoose.Types.ObjectId(v.toString()); }
  catch { return null; }
};

/* ── GET /api/messages/contacts ─────────────────────────────────────── */
export const getContacts = async (req, res) => {
  try {
    const myObjId = toObjId(req.user._id || req.user.id);
    if (!myObjId) return res.status(400).json({ message: "Invalid user id" });

    const myStr = myObjId.toString();

    // Fetch ALL messages where this user is sender or receiver
    const msgs = await Message.find({
      $or: [{ senderId: myObjId }, { receiverId: myObjId }],
    })
      .sort({ createdAt: -1 })
      .lean();

    // Build a map: otherId → { lastMessage, lastMessageAt, unread }
    const contactMap = new Map();

    for (const m of msgs) {
      const senderStr   = m.senderId?.toString();
      const receiverStr = m.receiverId?.toString();
      const otherId     = senderStr === myStr ? receiverStr : senderStr;

      if (!otherId) continue;

      if (!contactMap.has(otherId)) {
        const preview =
          m.content ||
          (m.type === "image" ? "📷 Image" :
           m.type === "file"  ? "📎 File"  : "");

        contactMap.set(otherId, {
          _id:           otherId,
          lastMessage:   preview,
          lastMessageAt: m.createdAt,
          unread:        0,
        });
      }

      // Count unread messages sent TO this user
      if (receiverStr === myStr && !m.read) {
        const entry  = contactMap.get(otherId);
        entry.unread = (entry.unread || 0) + 1;
        contactMap.set(otherId, entry);
      }
    }

    if (contactMap.size === 0) return res.json({ contacts: [] });

    // Fetch user info for all contact ids
    const ids   = [...contactMap.keys()].map(id => toObjId(id)).filter(Boolean);
    const users = await User.find({ _id: { $in: ids } })
      .select("name email role profileImage city phone isOnline lastSeen")
      .lean();

    const contacts = users
      .map((u) => ({
        ...u,
        _id: u._id.toString(),   // ensure string for frontend key
        ...contactMap.get(u._id.toString()),
      }))
      .sort((a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0));

    return res.json({ contacts });
  } catch (err) {
    console.error("getContacts error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/* ── GET /api/messages/:contactId ───────────────────────────────────── */
export const getMessages = async (req, res) => {
  try {
    const myObjId      = toObjId(req.user._id || req.user.id);
    const contactObjId = toObjId(req.params.contactId);

    if (!myObjId || !contactObjId)
      return res.status(400).json({ message: "Invalid id" });

    const messages = await Message.find({
      $or: [
        { senderId: myObjId,      receiverId: contactObjId },
        { senderId: contactObjId, receiverId: myObjId      },
      ],
    })
      .sort({ createdAt: 1 })
      .lean();

    return res.json({ messages });
  } catch (err) {
    console.error("getMessages error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/* ── POST /api/messages ─────────────────────────────────────────────── */
export const sendMessage = async (req, res) => {
  try {
    const senderId = req.user._id || req.user.id;
    const { receiverId, content, type = "text", fileUrl, fileName } = req.body;

    if (!receiverId)
      return res.status(400).json({ message: "receiverId required" });
    if (!content?.trim() && !fileUrl)
      return res.status(400).json({ message: "content or fileUrl required" });

    const receiver = await User.findById(receiverId).lean();
    if (!receiver)
      return res.status(404).json({ message: "Receiver not found" });

    const message = await Message.create({
      senderId,
      receiverId,
      content:  content  || "",
      type,
      fileUrl:  fileUrl  || null,
      fileName: fileName || null,
      read:     false,
    });

    const io           = req.app.get("io");
    const senderName   = req.user.name || req.user.email || "Someone";
    const preview      = content?.slice(0, 60) || (fileUrl ? "📎 Attachment" : "New message");
    const receiverRole = receiver.role || "client";
    const chatLink     = `/dashboard/${receiverRole}/messages?contact=${senderId}`;

    if (io) {
      io.to(`user_${receiverId}`).emit("newMessage", {
        ...message.toObject(),
        sender: { _id: senderId, name: senderName, role: req.user.role },
      });
    }

    try {
      const notif = await Notification.create({
        userId:  receiverId,
        title:   `💬 New message from ${senderName}`,
        message: preview,
        type:    "message",
        read:    false,
        link:    chatLink,
        data: {
          senderId:   senderId.toString(),
          senderName,
          senderRole: req.user.role,
          messageId:  message._id.toString(),
        },
      });

      if (io) {
        io.to(`user_${receiverId}`).emit("notification", {
          _id: notif._id, title: notif.title, body: preview,
          type: "message", link: chatLink, read: false,
          data: notif.data, createdAt: notif.createdAt,
        });
        io.to(`user_${receiverId}`).emit("badge_update", {
          type: "message", delta: +1, senderId: senderId.toString(),
        });
      }
    } catch (notifErr) {
      console.warn("Notification creation failed (non-fatal):", notifErr.message);
    }

    return res.status(201).json({ success: true, message });
  } catch (err) {
    console.error("sendMessage error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/* ── PATCH /api/messages/:contactId/read ────────────────────────────── */
export const markRead = async (req, res) => {
  try {
    const myId      = req.user._id || req.user.id;
    const contactId = req.params.contactId;

    await Message.updateMany(
      { senderId: contactId, receiverId: myId, read: false },
      { $set: { read: true, readAt: new Date() } }
    );

    return res.json({ success: true });
  } catch (err) {
    console.error("markRead error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/* ── DELETE /api/messages/:messageId ────────────────────────────────── */
export const deleteMessage = async (req, res) => {
  try {
    const myId = (req.user._id || req.user.id).toString();
    const msg  = await Message.findById(req.params.messageId);

    if (!msg)
      return res.status(404).json({ message: "Message not found" });
    if (msg.senderId.toString() !== myId)
      return res.status(403).json({ message: "Not authorised" });

    await msg.deleteOne();
    return res.json({ success: true });
  } catch (err) {
    console.error("deleteMessage error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};