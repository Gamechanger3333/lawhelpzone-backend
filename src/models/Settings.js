// backend/src/models/Settings.js
import mongoose from "mongoose";

const settingsSchema = new mongoose.Schema(
  {
    _id: { type: String, default: "global" },

    // General
    siteName:           { type: String,  default: "LawHelpZone" },
    siteDescription:    { type: String,  default: "Connect with legal experts instantly" },
    maintenanceMode:    { type: Boolean, default: false },
    allowRegistrations: { type: Boolean, default: true },
    defaultUserRole:    { type: String,  default: "client", enum: ["client", "lawyer"] },
    maxFileUploadMB:    { type: Number,  default: 10 },
    sessionTimeoutMins: { type: Number,  default: 30 },

    // Security
    maxLoginAttempts:         { type: Number,  default: 5 },
    lockoutDurationMins:      { type: Number,  default: 15 },
    requireEmailVerification: { type: Boolean, default: true },
    twoFactorEnabled:         { type: Boolean, default: false },
    passwordMinLength:        { type: Number,  default: 8 },
    jwtExpiryMins:            { type: Number,  default: 15 },
    refreshTokenDays:         { type: Number,  default: 30 },
    allowedOrigins:           { type: String,  default: "http://localhost:3000" },

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
  },
  { _id: false, timestamps: true }
);

export default mongoose.models.Settings || mongoose.model("Settings", settingsSchema);