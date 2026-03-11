// backend/src/controllers/chatController.js
// ✅ Full feature set:
//   GET    /api/messages/contacts              — contact list with unread counts
//   GET    /api/messages/:contactId            — message history
//   POST   /api/messages                       — send message + email + in-app notification
//   PATCH  /api/messages/:contactId/read       — mark messages as read
//   DELETE /api/messages/:messageId            — delete for everyone (sender only)
//   PATCH  /api/messages/:messageId            — edit message (sender only, within 15 min)
//   POST   /api/messages/:messageId/react      — add/toggle emoji reaction
//   POST   /api/messages/:contactId/typing     — broadcast typing indicator
//   GET    /api/messages/:contactId/typing-status — poll typing status

import Message      from "../models/Message.js";
import User         from "../models/User.js";
import Notification from "../models/Notification.js";
import mongoose     from "mongoose";
import nodemailer   from "nodemailer";

// ── Safely convert any value to ObjectId ─────────────────────────────────────
const toObjId = (v) => {
  try { return new mongoose.Types.ObjectId(v.toString()); }
  catch { return null; }
};

// ── In-memory typing store: { "senderId:receiverId": timestamp } ──────────────
// TTL = 8 seconds — if no new typing ping within 8s the indicator clears
const typingStore = new Map();
const TYPING_TTL  = 8000;

// ── Email notification helper — fire & forget, never crashes the request ──────
const sendEmailNotification = async ({ receiverId, senderName, senderEmail, preview }) => {
  // Skip if email env vars not configured
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return;

  try {
    const receiver = await User.findById(receiverId).select("email name").lean();
    if (!receiver?.email) return;

    const transporter = nodemailer.createTransporter({
      host:   process.env.EMAIL_HOST   || "smtp.gmail.com",
      port:   parseInt(process.env.EMAIL_PORT  || "587"),
      secure: process.env.EMAIL_SECURE === "true",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const previewText = preview
      ? (preview.length > 120 ? preview.slice(0, 120) + "…" : preview)
      : "📎 Sent you a file";

    const frontendUrl = process.env.FRONTEND_URL || "https://lawhelpzone-frontend-4fq6.vercel.app";
    const chatUrl     = `${frontendUrl}/dashboard/${receiver.role || "client"}/messages`;

    await transporter.sendMail({
      from:    `"LawHelpZone" <${process.env.EMAIL_USER}>`,
      to:      receiver.email,
      subject: `💬 New message from ${senderName}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
        <body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
          <div style="max-width:560px;margin:40px auto;padding:0 16px;">
            <div style="background:linear-gradient(135deg,#1d4ed8,#0891b2);border-radius:16px 16px 0 0;padding:28px 32px;text-align:center;">
              <h1 style="margin:0;color:#fff;font-size:22px;font-weight:800;">⚖️ LawHelpZone</h1>
              <p style="margin:6px 0 0;color:rgba(255,255,255,0.8);font-size:13px;">Legal Services Platform</p>
            </div>
            <div style="background:#fff;padding:32px;border:1px solid #e2e8f0;border-top:none;">
              <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">
                <div style="width:48px;height:48px;border-radius:50%;background:#3b82f6;color:#fff;font-size:20px;font-weight:800;text-align:center;line-height:48px;flex-shrink:0;">
                  ${(senderName || "?").charAt(0).toUpperCase()}
                </div>
                <div>
                  <p style="margin:0;font-size:16px;font-weight:700;color:#0f172a;">${senderName}</p>
                  <p style="margin:2px 0 0;font-size:12px;color:#64748b;">${senderEmail || "via LawHelpZone"}</p>
                </div>
              </div>
              <p style="margin:0 0 8px;font-size:12px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">New Message</p>
              <div style="background:#f8fafc;border:1px solid #e2e8f0;border-left:4px solid #3b82f6;border-radius:0 12px 12px 0;padding:16px 20px;margin-bottom:24px;">
                <p style="margin:0;font-size:15px;color:#0f172a;line-height:1.6;">${previewText}</p>
              </div>
              <p style="margin:0 0 20px;font-size:14px;color:#64748b;line-height:1.6;">
                Hi ${receiver.name || "there"}, you have a new message waiting. Click below to view and reply.
              </p>
              <div style="text-align:center;margin-bottom:24px;">
                <a href="${chatUrl}" style="display:inline-block;background:linear-gradient(135deg,#3b82f6,#0891b2);color:#fff;text-decoration:none;padding:14px 32px;border-radius:12px;font-size:15px;font-weight:700;">
                  📩 View Message
                </a>
              </div>
              <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;">
                To manage email notifications, visit your
                <a href="${frontendUrl}/dashboard/${receiver.role || "client"}/settings" style="color:#3b82f6;text-decoration:none;">account settings</a>.
              </p>
            </div>
            <div style="background:#f1f5f9;border-radius:0 0 16px 16px;padding:16px 32px;text-align:center;border:1px solid #e2e8f0;border-top:none;">
              <p style="margin:0;font-size:12px;color:#94a3b8;">© ${new Date().getFullYear()} LawHelpZone · Legal Services Platform</p>
            </div>
          </div>
        </body>
        </html>
      `,
    });

    console.log(`📧 Email notification sent to ${receiver.email}`);
  } catch (err) {
    // Never crash the main request
    console.error("Email notification failed (non-fatal):", err.message);
  }
};

/* ─────────────────────────────────────────────────────────────────────────────
   GET /api/messages/contacts
   Returns all users this person has exchanged messages with,
   plus lastMessage preview, lastMessageAt, unread count, online status.
───────────────────────────────────────────────────────────────────────────── */
export const getContacts = async (req, res) => {
  try {
    const myObjId = toObjId(req.user._id || req.user.id);
    if (!myObjId) return res.status(400).json({ message: "Invalid user id" });

    const myStr = myObjId.toString();

    const msgs = await Message.find({
      $or: [{ senderId: myObjId }, { receiverId: myObjId }],
      deletedFor: { $ne: myStr },           // hide messages deleted "for me"
    })
      .sort({ createdAt: -1 })
      .lean();

    const contactMap = new Map();

    for (const m of msgs) {
      const senderStr   = m.senderId?.toString();
      const receiverStr = m.receiverId?.toString();
      const otherId     = senderStr === myStr ? receiverStr : senderStr;
      if (!otherId) continue;

      if (!contactMap.has(otherId)) {
        const preview =
          m.deletedForEveryone ? "🚫 Message deleted" :
          m.content             ? m.content :
          m.type === "image"    ? "📷 Image" :
          m.type === "file"     ? "📎 File"  : "";

        contactMap.set(otherId, {
          _id:           otherId,
          lastMessage:   preview,
          lastMessageAt: m.createdAt,
          unread:        0,
        });
      }

      if (receiverStr === myStr && !m.read && !m.deletedForEveryone) {
        const entry  = contactMap.get(otherId);
        entry.unread = (entry.unread || 0) + 1;
        contactMap.set(otherId, entry);
      }
    }

    if (contactMap.size === 0) return res.json({ contacts: [] });

    const ids   = [...contactMap.keys()].map(id => toObjId(id)).filter(Boolean);
    const users = await User.find({ _id: { $in: ids } })
      .select("name email role profileImage city phone isOnline lastSeen")
      .lean();

    const contacts = users
      .map((u) => ({
        ...u,
        _id: u._id.toString(),
        ...contactMap.get(u._id.toString()),
      }))
      .sort((a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0));

    return res.json({ contacts });
  } catch (err) {
    console.error("getContacts error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/* ─────────────────────────────────────────────────────────────────────────────
   GET /api/messages/:contactId
   Returns full message history between the two users.
   Hides messages in the requester's deletedFor list.
───────────────────────────────────────────────────────────────────────────── */
export const getMessages = async (req, res) => {
  try {
    const myObjId      = toObjId(req.user._id || req.user.id);
    const contactObjId = toObjId(req.params.contactId);
    if (!myObjId || !contactObjId)
      return res.status(400).json({ message: "Invalid id" });

    const myStr = myObjId.toString();

    const messages = await Message.find({
      $or: [
        { senderId: myObjId,      receiverId: contactObjId },
        { senderId: contactObjId, receiverId: myObjId      },
      ],
      deletedFor: { $ne: myStr },
    })
      .sort({ createdAt: 1 })
      .lean();

    return res.json({ messages });
  } catch (err) {
    console.error("getMessages error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/* ─────────────────────────────────────────────────────────────────────────────
   POST /api/messages
   Send a new message. Also:
     • emits Socket.io "newMessage" to receiver's room
     • creates in-app Notification
     • fires email notification (non-blocking)
   Body: { receiverId, content?, fileUrl?, fileName?, type?, replyToId? }
───────────────────────────────────────────────────────────────────────────── */
export const sendMessage = async (req, res) => {
  try {
    const senderId = req.user._id || req.user.id;
    const { receiverId, content, type = "text", fileUrl, fileName, replyToId } = req.body;

    if (!receiverId)
      return res.status(400).json({ message: "receiverId required" });
    if (!content?.trim() && !fileUrl)
      return res.status(400).json({ message: "content or fileUrl required" });

    const receiver = await User.findById(receiverId).lean();
    if (!receiver) return res.status(404).json({ message: "Receiver not found" });

    // Build message document
    const msgData = {
      senderId,
      receiverId,
      content:   content   || "",
      type:      fileUrl ? (type === "image" || (fileName && /\.(jpg|jpeg|png|gif|webp)$/i.test(fileName)) ? "image" : "file") : "text",
      fileUrl:   fileUrl   || null,
      fileName:  fileName  || null,
      read:      false,
      reactions: {},
      deletedFor: [],
      deletedForEveryone: false,
      edited:    false,
    };

    // Attach reply reference if provided
    if (replyToId) {
      const replied = await Message.findById(replyToId).select("content senderId").lean();
      if (replied) {
        msgData.replyTo = {
          _id:      replied._id,
          content:  replied.content || "Attachment",
          senderId: replied.senderId,
        };
      }
    }

    const message = await Message.create(msgData);

    // ── Socket.io real-time delivery ─────────────────────────────────────────
    const io           = req.app.get("io");
    const senderName   = req.user.name  || req.user.email || "Someone";
    const senderEmail  = req.user.email || "";
    const preview      = content?.slice(0, 60) || (fileUrl ? "📎 Attachment" : "New message");
    const receiverRole = receiver.role  || "client";
    const chatLink     = `/dashboard/${receiverRole}/messages?contact=${senderId}`;

    if (io) {
      io.to(`user_${receiverId}`).emit("newMessage", {
        ...message.toObject(),
        sender: { _id: senderId, name: senderName, role: req.user.role },
      });
    }

    // ── In-app notification ───────────────────────────────────────────────────
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

    // ── Email notification — fire & forget ───────────────────────────────────
    sendEmailNotification({
      receiverId: receiverId.toString(),
      senderName,
      senderEmail,
      preview:    content || null,
    }).catch(() => {});

    return res.status(201).json({ success: true, message });
  } catch (err) {
    console.error("sendMessage error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/* ─────────────────────────────────────────────────────────────────────────────
   PATCH /api/messages/:contactId/read
   Mark all messages from contactId → me as read.
───────────────────────────────────────────────────────────────────────────── */
export const markRead = async (req, res) => {
  try {
    const myId      = req.user._id || req.user.id;
    const contactId = req.params.contactId;

    await Message.updateMany(
      { senderId: contactId, receiverId: myId, read: false },
      { $set: { read: true, readAt: new Date() } }
    );

    // Emit read receipt back to the sender via socket
    const io = req.app.get("io");
    if (io) {
      io.to(`user_${contactId}`).emit("messagesRead", {
        byUserId: myId.toString(),
        readAt:   new Date(),
      });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("markRead error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/* ─────────────────────────────────────────────────────────────────────────────
   DELETE /api/messages/:messageId
   Body: { mode: "me" | "everyone" }
     "me"       — adds requester's ID to message.deletedFor (soft delete)
     "everyone" — sets deletedForEveryone=true, clears content (sender only, within 60 hours)
───────────────────────────────────────────────────────────────────────────── */
export const deleteMessage = async (req, res) => {
  try {
    const myId = (req.user._id || req.user.id).toString();
    const mode = req.body?.mode || "everyone"; // default: delete for everyone (sender)

    const msg = await Message.findById(req.params.messageId);
    if (!msg) return res.status(404).json({ message: "Message not found" });

    if (mode === "everyone") {
      // Only sender can delete for everyone, and only within 60 hours
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

      // Notify receiver via socket
      const io = req.app.get("io");
      if (io) {
        io.to(`user_${msg.receiverId}`).emit("messageDeleted", {
          messageId: msg._id.toString(),
          mode: "everyone",
        });
      }
    } else {
      // "me" — soft delete: just hide from this user's view
      if (!msg.deletedFor.includes(myId)) {
        msg.deletedFor.push(myId);
        await msg.save();
      }
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("deleteMessage error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/* ─────────────────────────────────────────────────────────────────────────────
   PATCH /api/messages/:messageId
   Edit message content — sender only, within 15 minutes.
   Body: { content: "new text" }
───────────────────────────────────────────────────────────────────────────── */
export const editMessage = async (req, res) => {
  try {
    const myId    = (req.user._id || req.user.id).toString();
    const content = req.body?.content?.trim();

    if (!content) return res.status(400).json({ message: "content is required" });

    const msg = await Message.findById(req.params.messageId);
    if (!msg) return res.status(404).json({ message: "Message not found" });

    if (msg.senderId.toString() !== myId)
      return res.status(403).json({ message: "Only the sender can edit this message" });

    const ageMin = (Date.now() - new Date(msg.createdAt).getTime()) / 60000;
    if (ageMin > 15)
      return res.status(400).json({ message: "Edit window expired (15 minute limit)" });

    if (msg.deletedForEveryone)
      return res.status(400).json({ message: "Cannot edit a deleted message" });

    msg.content = content;
    msg.edited  = true;
    msg.editedAt = new Date();
    await msg.save();

    // Notify receiver of the edit via socket
    const io = req.app.get("io");
    if (io) {
      io.to(`user_${msg.receiverId}`).emit("messageEdited", {
        messageId: msg._id.toString(),
        content,
        editedAt:  msg.editedAt,
      });
    }

    return res.json({ success: true, message: msg });
  } catch (err) {
    console.error("editMessage error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/* ─────────────────────────────────────────────────────────────────────────────
   POST /api/messages/:messageId/react
   Toggle an emoji reaction. If the user already reacted with this emoji,
   remove it. Otherwise add it.
   Body: { emoji: "👍" }
───────────────────────────────────────────────────────────────────────────── */
export const reactToMessage = async (req, res) => {
  try {
    const myId  = (req.user._id || req.user.id).toString();
    const emoji = req.body?.emoji;

    if (!emoji) return res.status(400).json({ message: "emoji is required" });

    const msg = await Message.findById(req.params.messageId);
    if (!msg) return res.status(404).json({ message: "Message not found" });

    if (msg.deletedForEveryone)
      return res.status(400).json({ message: "Cannot react to a deleted message" });

    // Initialize reactions map if missing
    if (!msg.reactions) msg.reactions = {};

    const currentUsers = msg.reactions[emoji] || [];

    if (currentUsers.includes(myId)) {
      // Toggle off — remove this user
      msg.reactions[emoji] = currentUsers.filter(id => id !== myId);
      if (msg.reactions[emoji].length === 0) delete msg.reactions[emoji];
    } else {
      // Toggle on — add this user
      msg.reactions[emoji] = [...currentUsers, myId];
    }

    msg.markModified("reactions");
    await msg.save();

    // Broadcast reaction update to both parties
    const io       = req.app.get("io");
    const otherId  = msg.senderId.toString() === myId ? msg.receiverId : msg.senderId;
    if (io) {
      io.to(`user_${otherId}`).emit("messageReaction", {
        messageId: msg._id.toString(),
        reactions: msg.reactions,
        reactedBy: myId,
        emoji,
      });
    }

    return res.json({ success: true, reactions: msg.reactions });
  } catch (err) {
    console.error("reactToMessage error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/* ─────────────────────────────────────────────────────────────────────────────
   POST /api/messages/:contactId/typing
   Called by frontend while user is typing. Stores a timestamp and
   emits "typing" event to the contact's socket room.
   No body required.
───────────────────────────────────────────────────────────────────────────── */
export const setTyping = async (req, res) => {
  try {
    const myId      = (req.user._id || req.user.id).toString();
    const contactId = req.params.contactId;

    const key = `${myId}:${contactId}`;
    typingStore.set(key, Date.now());

    // Auto-expire after TYPING_TTL
    setTimeout(() => {
      const stored = typingStore.get(key);
      if (stored && Date.now() - stored >= TYPING_TTL) typingStore.delete(key);
    }, TYPING_TTL);

    // Emit typing event to contact's socket room
    const io = req.app.get("io");
    if (io) {
      io.to(`user_${contactId}`).emit("typing", {
        senderId:  myId,
        senderName: req.user.name || req.user.email,
        isTyping:  true,
      });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("setTyping error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/* ─────────────────────────────────────────────────────────────────────────────
   GET /api/messages/:contactId/typing-status
   Polled by frontend every 2.5s.
   Returns { isTyping: bool } — true if contact pinged typing within the TTL.
───────────────────────────────────────────────────────────────────────────── */
export const getTypingStatus = async (req, res) => {
  try {
    const myId      = (req.user._id || req.user.id).toString();
    const contactId = req.params.contactId;

    const key       = `${contactId}:${myId}`; // contact is the one typing TO me
    const lastPing  = typingStore.get(key);
    const isTyping  = !!lastPing && (Date.now() - lastPing < TYPING_TTL);

    return res.json({ isTyping });
  } catch (err) {
    console.error("getTypingStatus error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};