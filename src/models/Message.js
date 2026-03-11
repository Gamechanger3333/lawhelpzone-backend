// backend/src/models/Message.js
import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    // ── Core fields ───────────────────────────────────────────────────────────
    senderId:   { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    receiverId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    content:    { type: String,  default: "" },
    type:       { type: String,  enum: ["text", "image", "file", "link", "audio"], default: "text" },
    fileUrl:    { type: String,  default: null },
    fileName:   { type: String,  default: null },

    // ── Read receipt ──────────────────────────────────────────────────────────
    read:       { type: Boolean, default: false },
    readAt:     { type: Date,    default: null  },

    // ── Legacy single-flag delete (kept for backward compat) ──────────────────
    deleted:    { type: Boolean, default: false },

    // ── Reply-to: snapshot of the quoted message ──────────────────────────────
    replyTo: {
      _id:      { type: mongoose.Schema.Types.ObjectId },
      content:  { type: String, default: "" },
      senderId: { type: mongoose.Schema.Types.ObjectId },
    },

    // ── Edit tracking ─────────────────────────────────────────────────────────
    edited:   { type: Boolean, default: false },
    editedAt: { type: Date,    default: null  },

    // ── Emoji reactions ───────────────────────────────────────────────────────
    // Shape: { "👍": ["userId1", "userId2"], "❤️": ["userId3"] }
    reactions: {
      type:    mongoose.Schema.Types.Mixed,
      default: {},
    },

    // ── Soft delete "for me" ──────────────────────────────────────────────────
    // Array of user ID strings who chose "delete for me"
    deletedFor: {
      type:    [String],
      default: [],
    },

    // ── Hard delete "for everyone" ────────────────────────────────────────────
    // Sender only, within 60 hours — content is wiped when true
    deletedForEveryone: {
      type:    Boolean,
      default: false,
    },
  },
  { timestamps: true }  // adds createdAt + updatedAt
);

// ── Indexes ───────────────────────────────────────────────────────────────────
messageSchema.index({ senderId: 1, receiverId: 1, createdAt: -1 }); // conversation queries
messageSchema.index({ receiverId: 1, read: 1 });                     // unread count queries

export default mongoose.models.Message || mongoose.model("Message", messageSchema);