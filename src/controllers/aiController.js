// backend/src/controllers/aiController.js
// Handles all AI-powered endpoints.
// Uses geminiService.js — never calls Gemini API directly.

import {
  getLegalAssistantReply,
  getAdminAssistantReply,
  classifyCase,
  analyzeDocument,
  getLawyerCaseAssistance,
  getPlatformInsights,
} from "../utils/groqService.js";
import User from "../models/User.js";
import Case from "../models/Case.js";

// ── In-memory cache for platform insights (saves Gemini quota) ────────────────
const insightsCache = {
  data: null,
  fetchedAt: null,
  TTL_MS: 60 * 60 * 1000, // 1 hour (was 10 minutes — too short, burned quota on every visit)

  isValid() {
    return this.data && this.fetchedAt && Date.now() - this.fetchedAt < this.TTL_MS;
  },

  set(data) {
    this.data = data;
    this.fetchedAt = Date.now();
  },

  get() {
    return this.data;
  },

  clear() {
    this.data = null;
    this.fetchedAt = null;
  },

  ageSeconds() {
    return this.fetchedAt ? Math.floor((Date.now() - this.fetchedAt) / 1000) : null;
  },
};

// ── Helper: fetch live platform context for AI ────────────────────────────────
const fetchPlatformContext = async (role, userId) => {
  try {
    if (role === "admin") {
      const start = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      const [totalUsers, totalLawyers, totalClients, totalAdmins, totalCases, thisMonthCases, openCases, inProgressCases] =
        await Promise.all([
          User.countDocuments(),
          User.countDocuments({ role: "lawyer" }),
          User.countDocuments({ role: "client" }),
          User.countDocuments({ role: "admin" }),
          Case.countDocuments(),
          Case.countDocuments({ createdAt: { $gte: start } }),
          Case.countDocuments({ status: "open" }),
          Case.countDocuments({ status: "in-progress" }),
        ]);
      return { totalUsers, totalLawyers, totalClients, totalAdmins, totalCases, thisMonthCases, openCases, inProgressCases };
    }
    if (role === "client") {
      const [activeCases, totalCases, resolvedCases] = await Promise.all([
        Case.countDocuments({ clientId: userId, status: { $in: ["open", "in-progress"] } }),
        Case.countDocuments({ clientId: userId }),
        Case.countDocuments({ clientId: userId, status: "closed" }),
      ]);
      return { activeCases, totalCases, resolvedCases };
    }
    if (role === "lawyer") {
      const [activeCases, closedCases, proposalsSent] = await Promise.all([
        Case.countDocuments({ assignedLawyerId: userId, status: { $in: ["open", "in-progress"] } }),
        Case.countDocuments({ assignedLawyerId: userId, status: "closed" }),
        Case.countDocuments({ "proposals.lawyerId": userId }),
      ]);
      return { activeCases, closedCases, proposalsSent };
    }
  } catch (err) {
    console.error("Platform context fetch error:", err.message);
  }
  return null;
};

// ── Helper: user-friendly AI error message ────────────────────────────────────
const aiErrorMessage = (err) => {
  const msg = err.message || "";
  if (msg.includes("GEMINI_API_KEY") || msg.includes("not configured")) {
    return "AI is not configured. The server is missing a Gemini API key. Please contact the administrator.";
  }
  if (msg.includes("API key rejected") || msg.includes("401") || msg.includes("403")) {
    return "AI API key is invalid or expired. Please contact the administrator.";
  }
  if (msg.includes("quota") || msg.includes("429")) {
    return "AI usage limit reached. Please try again in a few minutes.";
  }
  if (msg.includes("All Gemini models failed")) {
    return "AI service is temporarily unavailable. Please try again shortly.";
  }
  return "AI assistant encountered an error. Please try again in a moment.";
};

// ── GET /api/ai/status ────────────────────────────────────────────────────────
// Health check — confirms Gemini key is set (doesn't call Gemini, just checks env)
export const aiStatus = (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  const configured = !!(apiKey && apiKey.trim() && apiKey !== "AIza...");
  return res.json({
    success: true,
    ai: {
      configured,
      status: configured ? "ready" : "missing_api_key",
      message: configured
        ? "Gemini API key is configured."
        : "GEMINI_API_KEY is not set in environment variables.",
    },
  });
};

// ── POST /api/ai/chat ─────────────────────────────────────────────────────────
export const legalChat = async (req, res) => {
  try {
    const { message, history = [] } = req.body;

    if (!message?.trim()) {
      return res.status(400).json({ success: false, message: "Message is required" });
    }
    if (message.length > 2000) {
      return res.status(400).json({ success: false, message: "Message too long (max 2000 characters)" });
    }

    const platformContext = await fetchPlatformContext(req.user.role, req.user._id);
    const reply = await getLegalAssistantReply(message.trim(), history, platformContext);

    return res.json({
      success: true,
      reply,
      disclaimer: "AI provides informational assistance only and does not constitute legal advice.",
    });
  } catch (err) {
    console.error("AI chat error:", err.message);
    return res.status(500).json({ success: false, message: aiErrorMessage(err) });
  }
};

// ── POST /api/ai/admin-chat ───────────────────────────────────────────────────
export const adminChat = async (req, res) => {
  try {
    const { message, history = [] } = req.body;

    if (!message?.trim()) {
      return res.status(400).json({ success: false, message: "Message is required" });
    }
    if (message.length > 2000) {
      return res.status(400).json({ success: false, message: "Message too long (max 2000 characters)" });
    }

    const platformContext = await fetchPlatformContext("admin", req.user._id);
    const reply = await getAdminAssistantReply(message.trim(), history, platformContext);

    return res.json({ success: true, reply, platformContext });
  } catch (err) {
    console.error("Admin AI chat error:", err.message);
    return res.status(500).json({ success: false, message: aiErrorMessage(err) });
  }
};

// ── GET /api/ai/platform-insights ────────────────────────────────────────────
// Cached for 10 minutes to avoid burning Gemini free-tier quota on every click.
export const platformInsightsHandler = async (req, res) => {
  try {
    // Return cached result if still fresh
    if (insightsCache.isValid()) {
      console.log(`Platform insights served from cache (${insightsCache.ageSeconds()}s old)`);
      return res.json({
        success: true,
        ...insightsCache.get(),
        cached: true,
        cacheAgeSeconds: insightsCache.ageSeconds(),
      });
    }

    // Force-refresh: clear cache when ?refresh=true is passed
    if (req.query.refresh === "true") {
      insightsCache.clear();
    }

    const start = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const [totalUsers, totalLawyers, totalClients, totalCases, thisMonthCases, openCases] =
      await Promise.all([
        User.countDocuments(),
        User.countDocuments({ role: "lawyer" }),
        User.countDocuments({ role: "client" }),
        Case.countDocuments(),
        Case.countDocuments({ createdAt: { $gte: start } }),
        Case.countDocuments({ status: "open" }),
      ]);

    const stats = { totalUsers, totalLawyers, totalClients, totalCases, thisMonthCases, openCases };
    const insights = await getPlatformInsights(stats);

    // Store in cache
    insightsCache.set({ insights, stats });

    return res.json({ success: true, insights, stats, cached: false });
  } catch (err) {
    console.error("Platform insights error:", err.message);

    // If Gemini fails but we have stale cache, return it with a warning
    if (insightsCache.get()) {
      console.log("Gemini failed — serving stale cache as fallback");
      return res.json({
        success: true,
        ...insightsCache.get(),
        cached: true,
        stale: true,
        cacheAgeSeconds: insightsCache.ageSeconds(),
        warning: "Live AI unavailable. Showing last known insights.",
      });
    }

    return res.status(500).json({ success: false, message: aiErrorMessage(err) });
  }
};

// ── POST /api/ai/classify-case ────────────────────────────────────────────────
export const classifyCaseHandler = async (req, res) => {
  try {
    const { title, description } = req.body;

    if (!title || !description) {
      return res.status(400).json({ success: false, message: "Title and description are required" });
    }
    if (description.length < 20) {
      return res.status(400).json({ success: false, message: "Description too short for classification" });
    }

    const result = await classifyCase(title, description);

    return res.json({
      success: true,
      classification: result,
      disclaimer: "AI classification is a suggestion only. Final categorization may differ.",
    });
  } catch (err) {
    console.error("Case classification error:", err.message);
    return res.status(500).json({ success: false, message: aiErrorMessage(err) });
  }
};

// ── POST /api/ai/analyze-document ────────────────────────────────────────────
export const analyzeDocumentHandler = async (req, res) => {
  try {
    const { text, fileName = "document" } = req.body;

    if (!text?.trim()) {
      return res.status(400).json({ success: false, message: "Document text is required" });
    }
    if (text.length < 50) {
      return res.status(400).json({ success: false, message: "Document content too short to analyze" });
    }

    const result = await analyzeDocument(text, fileName);

    return res.json({
      success: true,
      analysis: result,
      disclaimer: "AI analysis is for informational purposes only. Always have a qualified lawyer review legal documents.",
    });
  } catch (err) {
    console.error("Document analysis error:", err.message);
    return res.status(500).json({ success: false, message: aiErrorMessage(err) });
  }
};

// ── POST /api/ai/lawyer-assist ────────────────────────────────────────────────
export const lawyerAssistHandler = async (req, res) => {
  try {
    const { caseTitle, caseDescription, requestType = "summarize" } = req.body;

    if (!caseTitle || !caseDescription) {
      return res.status(400).json({ success: false, message: "Case title and description are required" });
    }

    const validTypes = ["summarize", "response", "tasks"];
    if (!validTypes.includes(requestType)) {
      return res.status(400).json({ success: false, message: `requestType must be one of: ${validTypes.join(", ")}` });
    }

    const result = await getLawyerCaseAssistance(caseTitle, caseDescription, requestType);

    return res.json({
      success: true,
      result,
      requestType,
      disclaimer: "AI-generated content must be reviewed by the lawyer before use.",
    });
  } catch (err) {
    console.error("Lawyer assist error:", err.message);
    return res.status(500).json({ success: false, message: aiErrorMessage(err) });
  }
};