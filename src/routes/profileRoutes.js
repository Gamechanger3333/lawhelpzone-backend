// backend/src/routes/profileRoutes.js
// Mount: app.use("/api", profileRoutes)
import express from "express";
import User from "../models/User.js";
import { protect, restrictTo } from "../middleware/authMiddleware.js";
import {
  getMe,
  updateProfile,
  updateClientProfile,
  updateAdminProfile,
  changePassword,          // ← move this handler to profileController.js
} from "../controllers/profileController.js";

const router = express.Router();

// GET /api/auth/me
router.get("/auth/me", protect, getMe);

// GET /api/users/:id — public profile lookup (messages, video calls)
router.get("/users/:id", protect, async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select("name email role profileImage isOnline lastSeen phone city country createdAt lawyerProfile.specializations lawyerProfile.bio lawyerProfile.hourlyRate lawyerProfile.rating")
      .lean();
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// PUT /api/auth/profile
router.put("/auth/profile", protect, updateProfile);

// POST /api/auth/change-password
router.post("/auth/change-password", protect, changePassword);

// PUT /api/clients/profile
router.put("/clients/profile", protect, restrictTo("client"), updateClientProfile);

// PUT /api/admin/profile
router.put("/admin/profile", protect, restrictTo("admin"), updateAdminProfile);

export default router;