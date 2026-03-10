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
import multer from "multer";
import lawyerRoutes from "./routes/lawyerRoutes.js";
import callRoutes from "./routes/callRoutes.js";
import searchRoutes from "./routes/searchRoutes.js";
import profileRoutes from "./routes/profileRoutes.js";
import connectDB from "./config/database.js";

dotenv.config();
connectDB();

const app = express();

// ==================== CORS — MUST be first, before everything ====================
app.use(cors({
  origin: true,          // reflects request origin — works for all origins including Vercel previews
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Cookie", "X-Requested-With"],
}));

// ✅ Express v5 preflight handler — "/{*path}" required (path-to-regexp v8 broke "*")
app.options("/{*path}", (req, res) => {
  res.header("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type,Authorization,Cookie,X-Requested-With");
  res.sendStatus(204);
});

// ── Socket.io ────────────────────────────────────────────────────────────────
import { initializeSocket } from "./utils/socket.js";

// ── Security + Rate limiter ───────────────────────────────────────────────────
import { securityMiddleware } from "./middleware/security.js";
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

// Security (helmet etc) — AFTER CORS so helmet doesn't override our headers
securityMiddleware(app);

// Body parsers
app.use(cookieParser());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// ✅ Static uploads — cross-origin headers so profile images load on Vercel
app.use("/uploads", (req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Cross-Origin-Resource-Policy", "cross-origin");
  res.header("Cross-Origin-Embedder-Policy", "unsafe-none");
  next();
}, express.static(uploadsDir));

// Rate limiting
app.use("/api", apiLimiter);

// Socket.io
const io = initializeSocket(httpServer);
app.set("io", io);

// ==================== ROUTES ====================

import authRoutes         from "./routes/authRoutes.js";
import caseRoutes         from "./routes/caseRoutes.js";
import chatRoutes         from "./routes/chatRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import dashboardRoutes    from "./routes/dashboardRoutes.js";
import adminRoutes        from "./routes/adminroute.js";
import settingsRoutes     from "./routes/settingsRoutes.js";

app.use("/api/auth",          authRoutes);
app.use("/api/messages",      chatRoutes);
app.use("/api",               profileRoutes);
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

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename:    (req, file, cb) => {
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

  // ✅ Uses BACKEND_URL env var — uploaded file URLs point to Railway, not localhost
  const baseUrl = process.env.BACKEND_URL || "https://lawhelpzone-backend-production.up.railway.app";
  const url = `${baseUrl}/uploads/${req.file.filename}`;

  res.json({
    success:  true,
    url,
    fileUrl:  url,
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
    ],
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
    const field = Object.keys(err.keyPattern || {})[0] || "field";
    return res.status(400).json({ success: false, message: `${field} already exists` });
  }

  // JWT errors
  if (err.name === "JsonWebTokenError") {
    return res.status(401).json({ success: false, message: "Invalid token" });
  }
  if (err.name === "TokenExpiredError") {
    return res.status(401).json({ success: false, message: "Token expired" });
  }

  // Multer errors
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

httpServer.listen(PORT, "0.0.0.0", () => {
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