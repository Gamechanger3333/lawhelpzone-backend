// backend/src/controllers/chatController.js
import Message      from "../models/Message.js";
import User         from "../models/User.js";
import Notification from "../models/Notification.js";
import mongoose     from "mongoose";
import { sendEmail } from "../utils/emailService.js";

const toObjId = (v) => {
  try { return new mongoose.Types.ObjectId(v.toString()); }
  catch { return null; }
};

// In-memory typing store — works fine for a single server instance
const typingStore = new Map();
const TYPING_TTL  = 8000;

// Fire-and-forget email notification on new message
const sendEmailNotification = async ({ receiverId, senderName, senderEmail, preview }) => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return;
  try {
    const receiver = await User.findById(receiverId).select("email name role").lean();
    if (!receiver?.email) return;

    const previewText = preview ? preview.slice(0, 120) : "📎 Sent you a file";
    const frontendUrl = process.env.FRONTEND_URL || "https://lawhelpzone.com";
    const chatUrl     = `${frontendUrl}/dashboard/${receiver.role || "client"}/messages`;

    await sendEmail({
      to:      receiver.email,
      subject: `💬 New message from ${senderName}`,
      html:    buildEmailHtml({ senderName, senderEmail, previewText, receiver, chatUrl, frontendUrl }),
    });
  } catch (err) {
    console.error("Email notification failed (non-fatal):", err.message);
  }
};

const buildEmailHtml = ({ senderName, senderEmail, previewText, receiver, chatUrl, frontendUrl }) => `
<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:40px auto;padding:0 16px;">
    <div style="background:linear-gradient(135deg,#1d4ed8,#0891b2);border-radius:16px 16px 0 0;padding:28px 32px;text-align:center;">
      <h1 style="margin:0;color:#fff;font-size:22px;font-weight:800;">⚖️ LawHelpZone</h1>
    </div>
    <div style="background:#fff;padding:32px;border:1px solid #e2e8f0;border-top:none;">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">
        <div style="width:48px;height:48px;border-radius:50%;background:#3b82f6;color:#fff;font-size:20px;font-weight:800;text-align:center;line-height:48px;">
          ${(senderName || "?").charAt(0).toUpperCase()}
        </div>
        <div>
          <p style="margin:0;font-size:16px;font-weight:700;color:#0f172a;">${senderName}</p>
          <p style="margin:2px 0 0;font-size:12px;color:#64748b;">${senderEmail || "via LawHelpZone"}</p>
        </div>
      </div>
      <div style="background:#f8fafc;border-left:4px solid #3b82f6;border-radius:0 12px 12px 0;padding:16px 20px;margin-bottom:24px;">
        <p style="margin:0;font-size:15px;color:#0f172a;">${previewText}</p>
      </div>
      <p style="margin:0 0 20px;font-size:14px;color:#64748b;">Hi ${receiver.name || "there"}, you have a new message waiting.</p>
      <div style="text-align:center;">
        <a href="${chatUrl}" style="display:inline-block;background:linear-gradient(135deg,#3b82f6,#0891b2);color:#fff;text-decoration:none;padding:14px 32px;border-radius:12px;font-size:15px;font-weight:700;">
          📩 View Message
        </a>
      </div>
    </div>
    <div style="background:#f1f5f9;border-radius:0 0 16px 16px;padding:16px;text-align:center;border:1px solid #e2e8f0;border-top:none;">
      <p style="margin:0;font-size:12px;color:#94a3b8;">© ${new Date().getFullYear()} LawHelpZone</p>
    </div>
  </div>
</body></html>`;

// GET /api/messages/users
export const getAllUsers = async (req, res) => {
  try {
    const users = await User.find({ _id: { $ne: req.user._id } })
      .select("name email role profileImage isOnline lastSeen lawyerProfile.specializations lawyerProfile.rating")
      .sort({ role: 1, name: 1 })
      .lean();
    return res.json({ success: true, users });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/messages/contacts
export const getContacts = async (req, res) => {
  try {
    const myObjId = toObjId(req.user._id);
    if (!myObjId) return res.status(400).json({ message: "Invalid user id" });
    const myStr = myObjId.toString();

    const msgs = await Message.find({
      $or: [{ senderId: myObjId }, { receiverId: myObjId }],
      deletedFor: { $ne: myStr },
    }).sort({ createdAt: -1 }).lean();

    const contactMap = new Map();

    for (const m of msgs) {
      const otherId = m.senderId?.toString() === myStr
        ? m.receiverId?.toString()
        : m.senderId?.toString();
      if (!otherId) continue;

      if (!contactMap.has(otherId)) {
        const preview =
          m.deletedForEveryone ? "🚫 Message deleted" :
          m.content            ? m.content :
          m.type === "image"   ? "📷 Image" :
          m.type === "file"    ? "📎 File"  : "";

        contactMap.set(otherId, { _id: otherId, lastMessage: preview, lastMessageAt: m.createdAt, unread: 0 });
      }

      if (m.receiverId?.toString() === myStr && !m.read && !m.deletedForEveryone) {
        contactMap.get(otherId).unread += 1;
      }
    }

    if (contactMap.size === 0) return res.json({ contacts: [] });

    const ids   = [...contactMap.keys()].map(id => toObjId(id)).filter(Boolean);
    const users = await User.find({ _id: { $in: ids } })
      .select("name email role profileImage isOnline lastSeen")
      .lean();

    const contacts = users
      .map(u => ({ ...u, _id: u._id.toString(), ...contactMap.get(u._id.toString()) }))
      .sort((a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0));

    return res.json({ contacts });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/messages/:contactId
export const getMessages = async (req, res) => {
  try {
    const myObjId      = toObjId(req.user._id);
    const contactObjId = toObjId(req.params.contactId);
    if (!myObjId || !contactObjId) return res.status(400).json({ message: "Invalid id" });

    const messages = await Message.find({
      $or: [
        { senderId: myObjId,      receiverId: contactObjId },
        { senderId: contactObjId, receiverId: myObjId      },
      ],
      deletedFor: { $ne: myObjId.toString() },
    }).sort({ createdAt: 1 }).lean();

    return res.json({ messages });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/messages
export const sendMessage = async (req, res) => {
  try {
    const senderId = req.user._id;
    const { receiverId, content, type = "text", fileUrl, fileName, replyToId } = req.body;

    if (!receiverId)                  return res.status(400).json({ message: "receiverId required" });
    if (!content?.trim() && !fileUrl) return res.status(400).json({ message: "content or fileUrl required" });

    const receiver = await User.findById(receiverId).lean();
    if (!receiver) return res.status(404).json({ message: "Receiver not found" });

    const msgType = fileUrl
      ? (type === "audio" || /\.(webm|ogg|mp3|wav|m4a)$/i.test(fileName || "") ? "audio" :
         type === "image" || /\.(jpg|jpeg|png|gif|webp)$/i.test(fileName || "") ? "image" : "file")
      : "text";

    const msgData = {
      senderId, receiverId,
      content:  content || "",
      type:     msgType,
      fileUrl:  fileUrl  || null,
      fileName: fileName || null,
      read:     false, reactions: {}, deletedFor: [], deletedForEveryone: false, edited: false,
    };

    if (replyToId) {
      const replied = await Message.findById(replyToId).select("content senderId").lean();
      if (replied) msgData.replyTo = { _id: replied._id, content: replied.content || "Attachment", senderId: replied.senderId };
    }

    const message    = await Message.create(msgData);
    const io         = req.app.get("io");
    const senderName = req.user.name || req.user.email || "Someone";
    const preview    = content?.slice(0, 60) || "📎 Attachment";
    const chatLink   = `/dashboard/${receiver.role || "client"}/messages?contact=${senderId}`;

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
        data:    { senderId: senderId.toString(), senderName, messageId: message._id.toString() },
      });
      if (io) {
        io.to(`user_${receiverId}`).emit("notification", {
          _id: notif._id, title: notif.title, body: preview,
          type: "message", link: chatLink, read: false, createdAt: notif.createdAt,
        });
        io.to(`user_${receiverId}`).emit("badge_update", { type: "message", delta: +1, senderId: senderId.toString() });
      }
    } catch (notifErr) {
      console.warn("Notification creation failed (non-fatal):", notifErr.message);
    }

    sendEmailNotification({ receiverId: receiverId.toString(), senderName, senderEmail: req.user.email, preview: content || null }).catch(() => {});

    return res.status(201).json({ success: true, message });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/messages/:contactId/read
export const markRead = async (req, res) => {
  try {
    const myId      = req.user._id;
    const contactId = req.params.contactId;

    await Message.updateMany(
      { senderId: contactId, receiverId: myId, read: false },
      { $set: { read: true, readAt: new Date() } }
    );

    req.app.get("io")?.to(`user_${contactId}`).emit("messagesRead", { byUserId: myId.toString(), readAt: new Date() });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/messages/:messageId  — body: { mode: "me" | "everyone" }
export const deleteMessage = async (req, res) => {
  try {
    const myId = req.user._id.toString();
    const mode = req.body?.mode || "everyone";
    const msg  = await Message.findById(req.params.messageId);
    if (!msg) return res.status(404).json({ message: "Message not found" });

    if (mode === "everyone") {
      if (msg.senderId.toString() !== myId)
        return res.status(403).json({ message: "Only the sender can delete for everyone" });

      const ageHours = (Date.now() - new Date(msg.createdAt).getTime()) / 3600000;
      if (ageHours > 60)
        return res.status(400).json({ message: "Delete for everyone expired (60 hour limit)" });

      msg.deletedForEveryone = true;
      msg.content  = "";
      msg.fileUrl  = null;
      msg.fileName = null;
      await msg.save();

      req.app.get("io")?.to(`user_${msg.receiverId}`).emit("messageDeleted", { messageId: msg._id.toString(), mode: "everyone" });
    } else {
      if (!msg.deletedFor.includes(myId)) {
        msg.deletedFor.push(myId);
        await msg.save();
      }
    }

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/messages/:messageId  — body: { content }
export const editMessage = async (req, res) => {
  try {
    const myId    = req.user._id.toString();
    const content = req.body?.content?.trim();
    if (!content) return res.status(400).json({ message: "content is required" });

    const msg = await Message.findById(req.params.messageId);
    if (!msg)                             return res.status(404).json({ message: "Message not found" });
    if (msg.senderId.toString() !== myId) return res.status(403).json({ message: "Only the sender can edit this message" });
    if (msg.deletedForEveryone)           return res.status(400).json({ message: "Cannot edit a deleted message" });

    const ageMin = (Date.now() - new Date(msg.createdAt).getTime()) / 60000;
    if (ageMin > 15) return res.status(400).json({ message: "Edit window expired (15 minute limit)" });

    msg.content  = content;
    msg.edited   = true;
    msg.editedAt = new Date();
    await msg.save();

    req.app.get("io")?.to(`user_${msg.receiverId}`).emit("messageEdited", { messageId: msg._id.toString(), content, editedAt: msg.editedAt });
    return res.json({ success: true, message: msg });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/messages/:messageId/react  — body: { emoji }
export const reactToMessage = async (req, res) => {
  try {
    const myId  = req.user._id.toString();
    const emoji = req.body?.emoji;
    if (!emoji) return res.status(400).json({ message: "emoji is required" });

    const msg = await Message.findById(req.params.messageId);
    if (!msg)                   return res.status(404).json({ message: "Message not found" });
    if (msg.deletedForEveryone) return res.status(400).json({ message: "Cannot react to a deleted message" });

    if (!msg.reactions) msg.reactions = {};
    const currentUsers = msg.reactions[emoji] || [];

    if (currentUsers.includes(myId)) {
      msg.reactions[emoji] = currentUsers.filter(id => id !== myId);
      if (msg.reactions[emoji].length === 0) delete msg.reactions[emoji];
    } else {
      msg.reactions[emoji] = [...currentUsers, myId];
    }

    msg.markModified("reactions");
    await msg.save();

    const otherId = msg.senderId.toString() === myId ? msg.receiverId : msg.senderId;
    req.app.get("io")?.to(`user_${otherId}`).emit("messageReaction", { messageId: msg._id.toString(), reactions: msg.reactions, reactedBy: myId, emoji });

    return res.json({ success: true, reactions: msg.reactions });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/messages/:contactId/typing
export const setTyping = async (req, res) => {
  try {
    const myId      = req.user._id.toString();
    const contactId = req.params.contactId;
    const key       = `${myId}:${contactId}`;

    typingStore.set(key, Date.now());
    setTimeout(() => {
      if (Date.now() - (typingStore.get(key) || 0) >= TYPING_TTL) typingStore.delete(key);
    }, TYPING_TTL);

    req.app.get("io")?.to(`user_${contactId}`).emit("typing", { senderId: myId, senderName: req.user.name || req.user.email, isTyping: true });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/messages/:contactId/typing-status
export const getTypingStatus = async (req, res) => {
  try {
    const myId      = req.user._id.toString();
    const contactId = req.params.contactId;
    const lastPing  = typingStore.get(`${contactId}:${myId}`);
    return res.json({ isTyping: !!lastPing && (Date.now() - lastPing < TYPING_TTL) });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};