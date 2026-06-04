// backend/src/routes/callRoutes.js
// Video/audio call signaling is handled via Socket.io in utils/socket.js.
// These REST routes handle call history logging only.
import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import CallLog from "../models/CallLog.js";

const router = express.Router();
router.use(protect);

// POST /api/calls/log — called by client when a call ends
router.post("/log", async (req, res) => {
  try {
    const { receiverId, status, startedAt, endedAt, type = "video" } = req.body;

    const duration =
      startedAt && endedAt
        ? Math.round((new Date(endedAt) - new Date(startedAt)) / 1000)
        : 0;

    const log = await CallLog.create({
      caller:    req.user._id,
      receiver:  receiverId,
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

// GET /api/calls/history — call history for logged-in user
router.get("/history", async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const filter = { $or: [{ caller: req.user._id }, { receiver: req.user._id }] };

    const [logs, total] = await Promise.all([
      CallLog.find(filter)
        .populate("caller",   "name profileImage")
        .populate("receiver", "name profileImage")
        .sort({ createdAt: -1 })
        .skip((page - 1) * Number(limit))
        .limit(Number(limit))
        .lean(),
      CallLog.countDocuments(filter),
    ]);

    res.json({
      success: true,
      calls: logs,
      pagination: { total, page: Number(page), pages: Math.ceil(total / Number(limit)) },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;