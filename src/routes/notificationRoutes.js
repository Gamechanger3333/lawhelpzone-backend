// backend/src/routes/notificationRoutes.js
import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import Notification from "../models/Notification.js";
import { createNotification } from "../utils/notificationService.js";

const router = express.Router();
router.use(protect);

// GET /api/notifications/unread-count
router.get("/unread-count", async (req, res) => {
  try {
    const count = await Notification.countDocuments({ userId: req.user._id, read: false });
    res.json({ success: true, count });
  } catch (err) {
    res.status(500).json({ success: false, count: 0, message: err.message });
  }
});

// GET /api/notifications
router.get("/", async (req, res) => {
  try {
    const { limit = 20, page = 1 } = req.query;
    const filter = { userId: req.user._id };

    const [notifications, unreadCount, total] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * Number(limit))
        .limit(Number(limit))
        .lean(),
      Notification.countDocuments({ ...filter, read: false }),
      Notification.countDocuments(filter),
    ]);

    res.json({ success: true, notifications, unreadCount, total });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/notifications — push a notification to any user (from frontend)
router.post("/", async (req, res) => {
  try {
    const { userId, title, body, type = "info", link = "", meta = {} } = req.body;

    if (!userId) return res.status(400).json({ success: false, message: "userId is required" });
    if (!title)  return res.status(400).json({ success: false, message: "title is required" });

    const notification = await createNotification({ userId, title, body, type, link, meta });

    req.app.get("io")?.to(`user_${userId}`).emit("notification", {
      _id: notification?._id,
      title, body, type, link,
      read: false,
      createdAt: new Date().toISOString(),
    });

    res.status(201).json({ success: true, notification });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/notifications/read-all — must be before /:id/read
router.patch("/read-all", async (req, res) => {
  try {
    await Notification.updateMany({ userId: req.user._id, read: false }, { $set: { read: true } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/notifications/:id/read
router.patch("/:id/read", async (req, res) => {
  try {
    const n = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { $set: { read: true } },
      { new: true }
    );
    if (!n) return res.status(404).json({ success: false, message: "Notification not found" });
    res.json({ success: true, notification: n });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/notifications/:id
router.delete("/:id", async (req, res) => {
  try {
    await Notification.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;