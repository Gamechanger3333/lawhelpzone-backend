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

dotenv.config();
connectDB();

const app = express();

// ==================== CORS — must be first ====================
const allowedOrigins = [
  "http://localhost:3000",
  "https://lawhelpzone-frontend-4fq6.vercel.app",
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // Allow all vercel preview deployments
    if (origin.endsWith(".vercel.app")) return callback(null, true);
    callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
}));

// Handle preflight for all routes
app.options("*", cors());

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

// Security middleware (after CORS)
securityMiddleware(app);

// Body parsers
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ✅ Serve uploaded files with cross-origin headers so images load on Vercel
app.use('/uploads', (req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Cross-Origin-Resource-Policy", "cross-origin");
  res.header("Cross-Origin-Embedder-Policy", "unsafe-none");
  next();
}, express.static(uploadsDir));

// Rate limiting
app.use('/api', apiLimiter);

// Initialize Socket.io
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

import multer from "multer";

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

  // ✅ Use BACKEND_URL env var so uploaded file URLs point to Railway, not localhost
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

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.path}`,
  });
});

app.use((err, req, res, next) => {
  console.error("Error:", err);

  if (err.name === "ValidationError") {
    const errors = Object.values(err.errors).map(e => e.message);
    return res.status(400).json({ success: false, message: "Validation Error", errors });
  }
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern)[0];
    return res.status(400).json({ success: false, message: `${field} already exists` });
  }
  if (err.name === "JsonWebTokenError") {
    return res.status(401).json({ success: false, message: "Invalid token" });
  }
  if (err.name === "TokenExpiredError") {
    return res.status(401).json({ success: false, message: "Token expired" });
  }
  if (err.name === "MulterError") {
    return res.status(400).json({ success: false, message: err.message });
  }

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

process.on("unhandledRejection", (err) => {
  console.error("Unhandled Rejection:", err);
  httpServer.close(() => process.exit(1));
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
  process.exit(1);
});

export default app;