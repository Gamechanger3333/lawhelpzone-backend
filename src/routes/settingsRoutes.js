// backend/src/routes/settingsRoutes.js
// Endpoints:
//   GET   /api/settings        — load settings (creates defaults on first call)
//   PUT   /api/settings        — save any subset of settings
//   POST  /api/settings/reset  — wipe and recreate defaults
// All routes: admin only
import express  from "express";
import mongoose from "mongoose";
import { protect, restrictTo } from "../middleware/authMiddleware.js";

const router = express.Router();

// ── Schema (single document, _id = "global") ────────────────────────
const schema = new mongoose.Schema({
  _id: { type: String, default: "global" },

  // General
  siteName:           { type: String,  default: "LawHelpZone" },
  siteDescription:    { type: String,  default: "Connect with legal experts instantly" },
  maintenanceMode:    { type: Boolean, default: false },
  allowRegistrations: { type: Boolean, default: true },
  defaultUserRole:    { type: String,  default: "client", enum: ["client","lawyer"] },
  maxFileUploadMB:    { type: Number,  default: 10 },
  sessionTimeoutMins: { type: Number,  default: 30 },

  // Security
  maxLoginAttempts:          { type: Number,  default: 5 },
  lockoutDurationMins:       { type: Number,  default: 15 },
  requireEmailVerification:  { type: Boolean, default: true },
  twoFactorEnabled:          { type: Boolean, default: false },
  passwordMinLength:         { type: Number,  default: 8 },
  jwtExpiryMins:             { type: Number,  default: 15 },
  refreshTokenDays:          { type: Number,  default: 30 },
  allowedOrigins:            { type: String,  default: "http://localhost:3000" },

  // Notifications
  emailNotifications: { type: Boolean, default: true },
  newUserAlert:       { type: Boolean, default: true },
  newCaseAlert:       { type: Boolean, default: true },
  proposalAlert:      { type: Boolean, default: true },
  systemAlerts:       { type: Boolean, default: true },
  adminEmail:         { type: String,  default: "" },
  smtpHost:           { type: String,  default: "" },
  smtpPort:           { type: String,  default: "587" },
  smtpUser:           { type: String,  default: "" },
  smtpSecure:         { type: Boolean, default: false },

  // Database / Backup
  backupEnabled:       { type: Boolean, default: true },
  backupIntervalHours: { type: Number,  default: 24 },
  maxConnections:      { type: Number,  default: 100 },
}, { _id: false, timestamps: true });

const Settings = mongoose.models.Settings || mongoose.model("Settings", schema);

// ── Helper: always returns the one settings document ────────────────
const getOrCreate = () =>
  Settings.findOneAndUpdate(
    { _id: "global" },
    { $setOnInsert: { _id: "global" } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

const ALLOWED_KEYS = [
  "siteName","siteDescription","maintenanceMode","allowRegistrations",
  "defaultUserRole","maxFileUploadMB","sessionTimeoutMins",
  "maxLoginAttempts","lockoutDurationMins","requireEmailVerification",
  "twoFactorEnabled","passwordMinLength","jwtExpiryMins","refreshTokenDays",
  "allowedOrigins","emailNotifications","newUserAlert","newCaseAlert",
  "proposalAlert","systemAlerts","adminEmail","smtpHost","smtpPort",
  "smtpUser","smtpSecure","backupEnabled","backupIntervalHours","maxConnections",
];

// ── GET /api/settings ────────────────────────────────────────────────
router.get("/", protect, restrictTo("admin"), async (_req, res) => {
  try {
    const s = await getOrCreate();
    res.json({ success: true, settings: s });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── PUT /api/settings ────────────────────────────────────────────────
router.put("/", protect, restrictTo("admin"), async (req, res) => {
  try {
    const updates = {};
    ALLOWED_KEYS.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

    if (!Object.keys(updates).length)
      return res.status(400).json({ success: false, message: "No valid fields provided" });

    const s = await Settings.findOneAndUpdate(
      { _id: "global" },
      { $set: updates },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, message: "Settings saved", settings: s });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/settings/reset — restore all defaults ──────────────────
router.post("/reset", protect, restrictTo("admin"), async (_req, res) => {
  try {
    await Settings.findOneAndDelete({ _id: "global" });
    const s = await getOrCreate();
    res.json({ success: true, message: "Settings reset to defaults", settings: s });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;