// backend/src/routes/callRoutes.js
// Video/audio call signaling is handled entirely via Socket.io events in utils/socket.js.
// These REST routes handle call history logging only.
import express from "express";
import mongoose from "mongoose";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

// ── Inline CallLog schema (lightweight — no separate file needed) ─────────────
const callLogSchema = new mongoose.Schema(
  {
    caller:    { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    receiver:  { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    status:    { type: String, enum: ["missed", "answered", "rejected"], default: "missed" },
    startedAt: { type: Date },
    endedAt:   { type: Date },
    duration:  { type: Number, default: 0 }, // seconds
    type:      { type: String, enum: ["video", "audio"], default: "video" },
  },
  { timestamps: true }
);

const CallLog = mongoose.models.CallLog || mongoose.model("CallLog", callLogSchema);

router.use(protect);

// POST /api/calls/log  — called by client when a call ends
router.post("/log", async (req, res) => {
  try {
    const { receiverId, status, startedAt, endedAt, type = "video" } = req.body;

    const duration =
      startedAt && endedAt
        ? Math.round((new Date(endedAt) - new Date(startedAt)) / 1000)
        : 0;

    const log = await CallLog.create({
      caller:   req.user._id,
      receiver: receiverId,
      status,
      startedAt: startedAt ? new Date(startedAt) : undefined,
      endedAt:   endedAt   ? new Date(endedAt)   : undefined,
      duration,
      type,
    });

    res.status(201).json({ success: true, log });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/calls/history  — call history for logged-in user
router.get("/history", async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    const logs = await CallLog.find({
      $or: [{ caller: req.user._id }, { receiver: req.user._id }],
    })
      .populate("caller",   "name profileImage")
      .populate("receiver", "name profileImage")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const total = await CallLog.countDocuments({
      $or: [{ caller: req.user._id }, { receiver: req.user._id }],
    });

    res.json({
      success: true,
      calls: logs,
      pagination: { total, page: Number(page), pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;