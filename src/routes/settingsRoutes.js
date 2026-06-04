// backend/src/routes/settingsRoutes.js
import express from "express";
import { protect, restrictTo } from "../middleware/authMiddleware.js";
import Settings from "../models/Settings.js";

const router = express.Router();

const ALLOWED_KEYS = [
  "siteName", "siteDescription", "maintenanceMode", "allowRegistrations",
  "defaultUserRole", "maxFileUploadMB", "sessionTimeoutMins",
  "maxLoginAttempts", "lockoutDurationMins", "requireEmailVerification",
  "twoFactorEnabled", "passwordMinLength", "jwtExpiryMins", "refreshTokenDays",
  "allowedOrigins", "emailNotifications", "newUserAlert", "newCaseAlert",
  "proposalAlert", "systemAlerts", "adminEmail", "smtpHost", "smtpPort",
  "smtpUser", "smtpSecure", "backupEnabled", "backupIntervalHours", "maxConnections",
];

const getOrCreate = () =>
  Settings.findOneAndUpdate(
    { _id: "global" },
    { $setOnInsert: { _id: "global" } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

router.use(protect, restrictTo("admin"));

// GET /api/settings
router.get("/", async (_req, res) => {
  try {
    res.json({ success: true, settings: await getOrCreate() });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/settings
router.put("/", async (req, res) => {
  try {
    const updates = {};
    ALLOWED_KEYS.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

    if (!Object.keys(updates).length)
      return res.status(400).json({ success: false, message: "No valid fields provided" });

    const settings = await Settings.findOneAndUpdate(
      { _id: "global" },
      { $set: updates },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, message: "Settings saved", settings });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/settings/reset
router.post("/reset", async (_req, res) => {
  try {
    await Settings.findOneAndDelete({ _id: "global" });
    res.json({ success: true, message: "Settings reset to defaults", settings: await getOrCreate() });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;