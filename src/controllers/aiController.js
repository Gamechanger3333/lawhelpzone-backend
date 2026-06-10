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
} from "../utils/geminiService.js";
import User from "../models/User.js";
import Case from "../models/Case.js";

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

// ── POST /api/ai/chat ─────────────────────────────────────────────────────────
// Legal assistant chatbot — available to all logged-in users.
// Body: { message, history: [{ role, content }] }
export const legalChat = async (req, res) => {
  try {
    const { message, history = [] } = req.body;

    if (!message?.trim()) {
      return res.status(400).json({ success: false, message: "Message is required" });
    }
    if (message.length > 2000) {
      return res.status(400).json({ success: false, message: "Message too long (max 2000 characters)" });
    }

    // Fetch live context for richer, platform-aware answers
    const platformContext = await fetchPlatformContext(req.user.role, req.user._id);

    const reply = await getLegalAssistantReply(message.trim(), history, platformContext);

    return res.json({
      success: true,
      reply,
      disclaimer: "AI provides informational assistance only and does not constitute legal advice.",
    });
  } catch (err) {
    console.error("AI chat error:", err.message);
    return res.status(500).json({
      success: false,
      message: "AI assistant encountered an error. Please try again in a moment.",
    });
  }
};

// ── POST /api/ai/admin-chat ───────────────────────────────────────────────────
// Admin-only AI assistant with full platform context.
// Body: { message, history: [{ role, content }] }
export const adminChat = async (req, res) => {
  try {
    const { message, history = [] } = req.body;

    if (!message?.trim()) {
      return res.status(400).json({ success: false, message: "Message is required" });
    }
    if (message.length > 2000) {
      return res.status(400).json({ success: false, message: "Message too long (max 2000 characters)" });
    }

    // Always fetch live platform context for admin
    const platformContext = await fetchPlatformContext("admin", req.user._id);

    const reply = await getAdminAssistantReply(message.trim(), history, platformContext);

    return res.json({
      success: true,
      reply,
      platformContext,
    });
  } catch (err) {
    console.error("Admin AI chat error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Admin AI assistant encountered an error. Please try again.",
    });
  }
};

// ── GET /api/ai/platform-insights ────────────────────────────────────────────
// Admin-only: AI-generated platform health insights.
export const platformInsightsHandler = async (req, res) => {
  try {
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

    return res.json({ success: true, insights, stats });
  } catch (err) {
    console.error("Platform insights error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Could not generate platform insights. Please try again.",
    });
  }
};

// ── POST /api/ai/classify-case ────────────────────────────────────────────────
// Auto-classifies a case when client submits it.
// Body: { title, description }
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
    return res.status(500).json({
      success: false,
      message: "Case classification encountered an error. Please try again.",
    });
  }
};

// ── POST /api/ai/analyze-document ────────────────────────────────────────────
// Analyzes uploaded document text.
// Body: { text, fileName }
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
    return res.status(500).json({
      success: false,
      message: "Document analysis encountered an error. Please try again.",
    });
  }
};

// ── POST /api/ai/lawyer-assist ────────────────────────────────────────────────
// Lawyer-only AI tools: summarize, draft response, extract tasks.
// Body: { caseTitle, caseDescription, requestType: "summarize" | "response" | "tasks" }
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
    return res.status(500).json({
      success: false,
      message: "AI lawyer assistant encountered an error. Please try again.",
    });
  }
};
