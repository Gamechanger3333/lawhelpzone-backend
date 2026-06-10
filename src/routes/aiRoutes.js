// backend/src/routes/aiRoutes.js
// All AI-powered endpoints.
// Mounted in server.js as: app.use("/api/ai", aiRoutes)

import express from "express";
import { protect }        from "../middleware/authMiddleware.js";
import { restrictTo }     from "../middleware/authMiddleware.js";
import { aiLimiter, chatAiLimiter } from "../middleware/aiRateLimit.js";
import {
  legalChat,
  adminChat,
  classifyCaseHandler,
  analyzeDocumentHandler,
  lawyerAssistHandler,
  platformInsightsHandler,
} from "../controllers/aiController.js";

const router = express.Router();

// All AI routes require authentication
router.use(protect);

// ── POST /api/ai/chat ─────────────────────────────────────────────────────────
// Legal assistant chat — all roles
router.post("/chat", chatAiLimiter, legalChat);

// ── POST /api/ai/admin-chat ───────────────────────────────────────────────────
// Admin-only AI assistant with full platform context
router.post("/admin-chat", chatAiLimiter, restrictTo("admin"), adminChat);

// ── GET /api/ai/platform-insights ─────────────────────────────────────────────
// Admin-only: AI-generated platform health insights
router.get("/platform-insights", aiLimiter, restrictTo("admin"), platformInsightsHandler);

// ── POST /api/ai/classify-case ────────────────────────────────────────────────
// Case auto-classification — clients and admins only
router.post("/classify-case", aiLimiter, restrictTo("client", "admin"), classifyCaseHandler);

// ── POST /api/ai/analyze-document ────────────────────────────────────────────
// Document analysis — clients, lawyers, admins
router.post("/analyze-document", aiLimiter, restrictTo("client", "lawyer", "admin"), analyzeDocumentHandler);

// ── POST /api/ai/lawyer-assist ────────────────────────────────────────────────
// Lawyer tools — lawyers and admins only
router.post("/lawyer-assist", aiLimiter, restrictTo("lawyer", "admin"), lawyerAssistHandler);

export default router;
