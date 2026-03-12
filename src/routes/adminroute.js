// backend/src/routes/adminRoutes.js
// Endpoints:
//   GET    /api/admin/users          — list all users (search, role, page)
//   GET    /api/admin/users/:id      — get single user
//   PUT    /api/admin/users/:id      — full update (edit modal)
//   PATCH  /api/admin/users/:id      — partial update (suspend / role toggle)
//   DELETE /api/admin/users/:id      — delete user
//   GET    /api/admin/stats          — platform stats
//   POST   /api/admin/broadcast      — send notification to all (or role-filtered) users
import express from "express";
import User    from "../models/User.js";
import Case    from "../models/Case.js";
import { protect, restrictTo }   from "../middleware/authMiddleware.js";
// createNotification is exported from notificationRoutes (same level as this file in routes/)
import { createNotification }    from "./notificationRoutes.js";

const router = express.Router();
router.use(protect, restrictTo("admin"));

// ── GET /api/admin/users ─────────────────────────────────────────────
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
    res.json({ success: true, users, total, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/admin/users/:id ─────────────────────────────────────────
router.get("/users/:id", async (req, res) => {
  try {
    const u = await User.findById(req.params.id)
      .select("-password -refreshToken -passwordResetToken -emailVerificationToken")
      .lean();
    if (!u) return res.status(404).json({ success: false, message: "User not found" });
    res.json({ success: true, user: u });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── PUT /api/admin/users/:id — full update from edit modal ───────────
router.put("/users/:id", async (req, res) => {
  try {
    const { name, role, phone, suspended, suspensionReason, verified, emailVerified } = req.body;
    if (req.params.id === req.user._id.toString() && role && role !== "admin")
      return res.status(400).json({ success: false, message: "Cannot change your own role" });

    const u = await User.findById(req.params.id);
    if (!u) return res.status(404).json({ success: false, message: "User not found" });

    const wasSuspended = u.suspended;

    if (name          !== undefined) u.name          = name;
    if (role          !== undefined) u.role          = role;
    if (phone         !== undefined) u.phone         = phone;
    if (suspended     !== undefined) u.suspended     = suspended;
    if (suspensionReason !== undefined) u.suspensionReason = suspensionReason;
    if (verified      !== undefined) u.verified      = verified;
    if (emailVerified !== undefined) u.emailVerified = emailVerified;

    await u.save({ validateBeforeSave: false });

    // Notify user if suspension status changed
    if (suspended !== undefined && suspended !== wasSuspended) {
      await createNotification({
        userId: u._id,
        title:  suspended ? "Account Suspended" : "Account Restored",
        body:   suspended
          ? `Your account has been suspended${suspensionReason ? ": " + suspensionReason : "."}`
          : "Your account has been restored. Welcome back!",
        type: "system",
      });
    }

    const safe = u.toObject();
    delete safe.password; delete safe.refreshToken; delete safe.passwordResetToken;
    res.json({ success: true, user: safe });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── PATCH /api/admin/users/:id — suspend / verify / role only ────────
router.patch("/users/:id", async (req, res) => {
  try {
    const { role, suspended, suspensionReason, verified } = req.body;
    const u = await User.findById(req.params.id);
    if (!u) return res.status(404).json({ success: false, message: "User not found" });

    const wasSuspended = u.suspended;
    if (role             !== undefined) u.role             = role;
    if (suspended        !== undefined) u.suspended        = suspended;
    if (suspensionReason !== undefined) u.suspensionReason = suspensionReason;
    if (verified         !== undefined) u.verified         = verified;

    await u.save({ validateBeforeSave: false });

    if (suspended !== undefined && suspended !== wasSuspended) {
      await createNotification({
        userId: u._id,
        title:  suspended ? "Account Suspended" : "Account Restored",
        body:   suspended
          ? `Your account has been suspended${suspensionReason ? ": " + suspensionReason : "."}`
          : "Your account has been restored.",
        type: "system",
      });
    }

    const safe = u.toObject();
    delete safe.password; delete safe.refreshToken;
    res.json({ success: true, user: safe });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── DELETE /api/admin/users/:id ──────────────────────────────────────
router.delete("/users/:id", async (req, res) => {
  try {
    if (req.params.id === req.user._id.toString())
      return res.status(400).json({ success: false, message: "Cannot delete your own account" });

    const u = await User.findByIdAndDelete(req.params.id);
    if (!u) return res.status(404).json({ success: false, message: "User not found" });
    res.json({ success: true, message: `User ${u.name || u.email} deleted` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/admin/stats ─────────────────────────────────────────────
router.get("/stats", async (req, res) => {
  try {
    const start = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const [totalUsers, totalLawyers, totalClients, totalAdmins, totalCases, thisMonthCases, openCases] =
      await Promise.all([
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

// ── POST /api/admin/broadcast ────────────────────────────────────────
router.post("/broadcast", async (req, res) => {
  try {
    const { title, body, type = "system", role } = req.body;
    if (!title) return res.status(400).json({ success: false, message: "Title is required" });

    const filter = role && role !== "all" ? { role } : {};
    const users  = await User.find(filter).select("_id").lean();
    await Promise.all(users.map(u => createNotification({ userId: u._id, title, body, type })));
    res.json({ success: true, sent: users.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;