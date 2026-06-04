// backend/src/routes/adminRoutes.js
import express from "express";
import User from "../models/User.js";
import Case from "../models/Case.js";
import { protect, restrictTo } from "../middleware/authMiddleware.js";
import { createNotification } from "../utils/notificationService.js";

const router = express.Router();
router.use(protect, restrictTo("admin"));

// ── Helper: notify user if suspension status changed ─────────────────────────
const notifySuspension = (user, suspended, reason) =>
  createNotification({
    userId: user._id,
    title:  suspended ? "Account Suspended" : "Account Restored",
    body:   suspended
      ? `Your account has been suspended${reason ? ": " + reason : "."}`
      : "Your account has been restored. Welcome back!",
    type: "system",
  });

// ── Helper: strip sensitive fields from user object ──────────────────────────
const safeUser = (user) => {
  const obj = user.toObject ? user.toObject() : { ...user };
  delete obj.password;
  delete obj.refreshToken;
  delete obj.passwordResetToken;
  return obj;
};

// GET /api/admin/users
router.get("/users", async (req, res) => {
  try {
    const { search, role, page = 1, limit = 500 } = req.query;
    const filter = {};
    if (role && role !== "all") filter.role = role;
    if (search) {
      filter.$or = [
        { name:  { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    const [users, total] = await Promise.all([
      User.find(filter)
        .select("-password -refreshToken -loginHistory -passwordResetToken -emailVerificationToken")
        .sort({ createdAt: -1 })
        .skip((page - 1) * Number(limit))
        .limit(Number(limit))
        .lean(),
      User.countDocuments(filter),
    ]);

    res.json({ success: true, users, total, pages: Math.ceil(total / Number(limit)) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/admin/users/:id
router.get("/users/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select("-password -refreshToken -passwordResetToken -emailVerificationToken")
      .lean();
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/admin/users/:id — full update
router.put("/users/:id", async (req, res) => {
  try {
    if (req.params.id === req.user._id.toString() && req.body.role && req.body.role !== "admin")
      return res.status(400).json({ success: false, message: "Cannot change your own role" });

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const wasSuspended = user.suspended;
    const { name, role, phone, suspended, suspensionReason, verified, emailVerified } = req.body;

    if (name             !== undefined) user.name             = name;
    if (role             !== undefined) user.role             = role;
    if (phone            !== undefined) user.phone            = phone;
    if (suspended        !== undefined) user.suspended        = suspended;
    if (suspensionReason !== undefined) user.suspensionReason = suspensionReason;
    if (verified         !== undefined) user.verified         = verified;
    if (emailVerified    !== undefined) user.emailVerified    = emailVerified;

    await user.save({ validateBeforeSave: false });

    if (suspended !== undefined && suspended !== wasSuspended)
      await notifySuspension(user, suspended, suspensionReason);

    res.json({ success: true, user: safeUser(user) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/admin/users/:id — partial update (suspend / role toggle)
router.patch("/users/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const wasSuspended = user.suspended;
    const { role, suspended, suspensionReason, verified } = req.body;

    if (role             !== undefined) user.role             = role;
    if (suspended        !== undefined) user.suspended        = suspended;
    if (suspensionReason !== undefined) user.suspensionReason = suspensionReason;
    if (verified         !== undefined) user.verified         = verified;

    await user.save({ validateBeforeSave: false });

    if (suspended !== undefined && suspended !== wasSuspended)
      await notifySuspension(user, suspended, suspensionReason);

    res.json({ success: true, user: safeUser(user) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/admin/users/:id
router.delete("/users/:id", async (req, res) => {
  try {
    if (req.params.id === req.user._id.toString())
      return res.status(400).json({ success: false, message: "Cannot delete your own account" });

    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    res.json({ success: true, message: `User ${user.name || user.email} deleted` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/admin/stats
router.get("/stats", async (_req, res) => {
  try {
    const start = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    const [
      totalUsers, totalLawyers, totalClients, totalAdmins,
      totalCases, thisMonthCases, openCases,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ role: "lawyer" }),
      User.countDocuments({ role: "client" }),
      User.countDocuments({ role: "admin" }),
      Case.countDocuments(),
      Case.countDocuments({ createdAt: { $gte: start } }),
      Case.countDocuments({ status: "open" }),
    ]);

    res.json({
      success: true,
      stats: { totalUsers, totalLawyers, totalClients, totalAdmins, totalCases, thisMonthCases, openCases },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/admin/broadcast
router.post("/broadcast", async (req, res) => {
  try {
    const { title, body, type = "system", role } = req.body;
    if (!title) return res.status(400).json({ success: false, message: "Title is required" });

    const users = await User.find(role && role !== "all" ? { role } : {}).select("_id").lean();
    await Promise.all(users.map(u => createNotification({ userId: u._id, title, body, type })));

    res.json({ success: true, sent: users.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;