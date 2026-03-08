// backend/src/server.js
import express from "express";
import { createServer } from "http";
import { protect } from "./middleware/authMiddleware.js";
import cors from "cors";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import lawyerRoutes from "./routes/lawyerRoutes.js"
import callRoutes from "./routes/callRoutes.js"
import searchRoutes from "./routes/searchRoutes.js"

import profileRoutes from "./routes/profileRoutes.js";
import connectDB from "./config/database.js"



// connect database
connectDB();

// ── dotenv.config() moved to top so env vars are available everywhere ──
dotenv.config();

const app = express()

// ── Import Socket.io ──────────────────────────────────────────────────────────
import { initializeSocket } from "./utils/socket.js";

// ── Import security middleware ────────────────────────────────────────────────
import { securityMiddleware } from "./middleware/security.js"
import { apiLimiter } from "./middleware/rateLimiter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);


const uploadsDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log("📁 Created uploads/ directory");
}

const httpServer = createServer(app);

// ==================== MIDDLEWARE ====================

// Security middleware
securityMiddleware(app);

// CORS Configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:3000",
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

// Body parsers
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files — use the resolved absolute path for reliability
app.use('/uploads', express.static(uploadsDir));

// Rate limiting
app.use('/api', apiLimiter);

// Initialize Socket.io and attach to app so controllers can access via req.app.get("io")
const io = initializeSocket(httpServer);
app.set("io", io);


// ==================== ROUTES ====================

import authRoutes         from "./routes/authRoutes.js"
import caseRoutes         from "./routes/caseRoutes.js"
import chatRoutes         from "./routes/chatRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import dashboardRoutes    from "./routes/dashboardRoutes.js"
import adminRoutes        from "./routes/adminroute.js"
import settingsRoutes     from "./routes/settingsRoutes.js";

app.use("/api/auth",     authRoutes);
app.use("/api/messages",  chatRoutes);
app.use("/api",          profileRoutes);

app.use("/api/cases",         caseRoutes);
app.use("/api/chat",          chatRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/dashboard",     dashboardRoutes);
app.use("/api/lawyers",       lawyerRoutes);
app.use("/api/calls",         callRoutes);
app.use("/api/search",        searchRoutes);
app.use("/api/admin",         adminRoutes);
app.use("/api/settings",      settingsRoutes);

// ==================== FILE UPLOAD ROUTE ====================

import multer from "multer";

const storage = multer.diskStorage({
  // ── Use the pre-resolved absolute path so uploads always land in the right place
  //    regardless of the working directory when the process was started
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename:    (req, file, cb) => {
    // Sanitise the original filename to strip characters that can break paths
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}-${safeName}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

app.post("/api/upload", protect, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ message: "No file uploaded" });

  const url = `${process.env.BACKEND_URL || "http://localhost:5000"}/uploads/${req.file.filename}`;

  res.json({
    success:  true,
    url,
    fileUrl:  url,           // alias so both field names work on the frontend
    fileName: req.file.originalname,
    fileSize: req.file.size,
  });
});

// ==================== UTILITY ROUTES ====================

app.get("/", (req, res) => {
  res.json({
    message: "LawHelpZone API is running ✅",
    version: "2.0.0",
    features: [
      "JWT Authentication with Refresh Tokens",
      "Email Verification",
      "Password Reset",
      "Real-time Chat (Socket.io)",
      "Real-time Notifications",
      "File Upload Support",
      "Rate Limiting",
      "Security Headers",
    ]
  });
});

app.get("/health", (req, res) => {
  res.json({
    status:    "healthy",
    timestamp: new Date().toISOString(),
    uptime:    process.uptime(),
    database:  mongoose.connection.readyState === 1 ? "connected" : "disconnected",
  });
});

// ==================== ERROR HANDLING ====================

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.path}`,
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("Error:", err);

  // Mongoose validation error
  if (err.name === "ValidationError") {
    const errors = Object.values(err.errors).map(e => e.message);
    return res.status(400).json({ success: false, message: "Validation Error", errors });
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern)[0];
    return res.status(400).json({ success: false, message: `${field} already exists` });
  }

  // JWT errors
  if (err.name === "JsonWebTokenError") {
    return res.status(401).json({ success: false, message: "Invalid token" });
  }
  if (err.name === "TokenExpiredError") {
    return res.status(401).json({ success: false, message: "Token expired" });
  }

  // Multer errors (file too large, unexpected field, etc.)
  if (err.name === "MulterError") {
    return res.status(400).json({ success: false, message: err.message });
  }

  // Default error
  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || "Internal server error",
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
});

// ==================== START SERVER ====================

const PORT = process.env.PORT || 5000;

httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📡 Socket.io enabled`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (err) => {
  console.error("Unhandled Rejection:", err);
  httpServer.close(() => process.exit(1));
});

// Handle uncaught exceptions
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
  process.exit(1);
});

export default app;