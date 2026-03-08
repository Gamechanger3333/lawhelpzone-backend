// backend/src/models/Notification.js
// This is the ONE canonical Notification schema used across the entire app.
// The inline schema that was in notificationRoutes.js has been removed — it
// conflicted with this file and caused type-enum validation failures.

import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "User",
      required: true,
      index:    true,
    },
    type: {
      type:     String,
      enum: [
        "message",
        "case_update",
        "new_proposal",
        "proposal_accepted",
        "proposal_rejected",
        "payment_received",
        "review_received",
        "system",
      ],
      required: true,
    },
    title:    { type: String, required: true },
    message:  { type: String, required: true },
    data:     { type: mongoose.Schema.Types.Mixed, default: {} },
    link:     { type: String, default: "" },
    read:     { type: Boolean, default: false },
    readAt:   { type: Date },
    icon:     { type: String },
    priority: {
      type:    String,
      enum:    ["low", "medium", "high", "urgent"],
      default: "medium",
    },
  },
  { timestamps: true }
);

notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ read: 1 });

const Notification =
  mongoose.models.Notification ||
  mongoose.model("Notification", notificationSchema);

export default Notification;
