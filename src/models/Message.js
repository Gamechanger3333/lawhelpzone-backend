// backend/src/models/Message.js
import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    senderId:   { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    receiverId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    content:    { type: String,  default: "" },
    type:       { type: String,  enum: ["text", "image", "file", "link", "audio"], default: "text" },
    fileUrl:    { type: String,  default: null },
    fileName:   { type: String,  default: null },
    read:       { type: Boolean, default: false },
    readAt:     { type: Date,    default: null },
    deleted:    { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Compound index for fast conversation queries between two users
messageSchema.index({ senderId: 1, receiverId: 1, createdAt: -1 });

export default mongoose.models.Message || mongoose.model("Message", messageSchema);
