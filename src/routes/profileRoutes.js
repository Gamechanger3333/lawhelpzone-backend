// backend/src/routes/profileRoutes.js
// Mount: app.use("/api", profileRoutes)

import express from "express";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import { protect, restrictTo } from "../middleware/authMiddleware.js";

import {
  getMe,
  updateProfile,
  updateClientProfile,
  updateAdminProfile,
} from "../controllers/profileController.js";

const router = express.Router();

// ─────────────────────────────────────────
// GET CURRENT USER
// GET /api/auth/me
// ─────────────────────────────────────────
router.get("/auth/me", protect, getMe);

// ─────────────────────────────────────────
// GET ANY USER'S PUBLIC PROFILE
// GET /api/users/:id
// Used by messages page, video calls, etc. to look up contact info
// ─────────────────────────────────────────
router.get("/users/:id", protect, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select(
      "name email role profileImage isOnline lastSeen phone city country createdAt lawyerProfile.specializations lawyerProfile.bio lawyerProfile.hourlyRate lawyerProfile.rating"
    );
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    res.json({ success: true, user });
  } catch (err) {
    console.error("GET /api/users/:id error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ─────────────────────────────────────────
// UPDATE BASIC PROFILE
// PUT /api/auth/profile
// ─────────────────────────────────────────
router.put("/auth/profile", protect, updateProfile);

// ─────────────────────────────────────────
// CHANGE PASSWORD
// POST /api/auth/change-password
// ─────────────────────────────────────────
router.post("/auth/change-password", protect, async (req, res) => {
  try {
    const { currentPassword, password, confirmPassword } = req.body;

    if (!currentPassword || !password || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "All password fields are required",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters",
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Passwords do not match",
      });
    }

    const user = await User.findById(req.user._id).select("+password");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const match = await bcrypt.compare(currentPassword, user.password);

    if (!match) {
      return res.status(401).json({
        success: false,
        message: "Current password incorrect",
      });
    }

    user.password = await bcrypt.hash(password, 12);
    await user.save();

    res.json({
      success: true,
      message: "Password changed successfully",
    });
  } catch (err) {
    console.error("change-password error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to change password",
    });
  }
});

// ─────────────────────────────────────────
// CLIENT PROFILE
// PUT /api/clients/profile
// ─────────────────────────────────────────
router.put(
  "/clients/profile",
  protect,
  restrictTo("client"),
  updateClientProfile
);

// ─────────────────────────────────────────
// ADMIN PROFILE
// PUT /api/admin/profile
// ─────────────────────────────────────────
router.put(
  "/admin/profile",
  protect,
  restrictTo("admin"),
  updateAdminProfile
);

export default router;