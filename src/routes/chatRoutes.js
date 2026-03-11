// backend/src/routes/chatRoutes.js
import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import {
  getContacts,
  getMessages,
  sendMessage,
  markRead,
  deleteMessage,
  editMessage,
  reactToMessage,
  setTyping,
  getTypingStatus,
} from "../controllers/chatController.js";

const router = express.Router();

// All chat routes require authentication
router.use(protect);

// ── Contacts ──────────────────────────────────────────────────────────────────
router.get("/contacts", getContacts);

// ── Send / receive messages ───────────────────────────────────────────────────
router.post("/",   sendMessage);                        // POST   /api/messages

// ── IMPORTANT: specific routes BEFORE /:contactId to avoid conflicts ─────────

// Typing indicators
router.post("/:contactId/typing",        setTyping);      // POST   /api/messages/:id/typing
router.get("/:contactId/typing-status",  getTypingStatus); // GET    /api/messages/:id/typing-status

// Mark conversation as read
router.patch("/:contactId/read",         markRead);       // PATCH  /api/messages/:id/read

// React to a specific message
router.post("/:messageId/react",         reactToMessage); // POST   /api/messages/:id/react

// Edit a specific message (sender only, within 15 min)
router.patch("/:messageId",              editMessage);    // PATCH  /api/messages/:id

// Delete a message — body: { mode: "me" | "everyone" }
router.delete("/:messageId",             deleteMessage);  // DELETE /api/messages/:id

// ── Message history — LAST because /:contactId catches everything ─────────────
router.get("/:contactId",               getMessages);    // GET    /api/messages/:id

export default router;