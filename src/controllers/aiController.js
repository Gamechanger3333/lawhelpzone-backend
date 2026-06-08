// backend/src/controllers/aiController.js
// Handles all AI-powered endpoints.
// Uses geminiService.js — never calls Gemini API directly.

import {
  getLegalAssistantReply,
  classifyCase,
  analyzeDocument,
  getLawyerCaseAssistance,
} from "../utils/geminiService.js";

// ── POST /api/ai/chat ─────────────────────────────────────────────────────────
// Legal assistant chatbot — available to all logged-in users.
// Body: { message, history: [{ role, content }] }

export const legalChat = async (req, res) => {
  try {
    const { message, history = [] } = req.body;

    if (!message?.trim()) {
      return res.status(400).json({ success: false, message: "Message is required" });
    }

    if (message.length > 1000) {
      return res.status(400).json({ success: false, message: "Message too long (max 1000 characters)" });
    }

    const reply = await getLegalAssistantReply(message.trim(), history);

    return res.json({
      success: true,
      reply,
      disclaimer: "AI provides informational assistance only and does not constitute legal advice.",
    });
  } catch (err) {
    console.error("AI chat error:", err.message);
    return res.status(500).json({
      success: false,
      message: "AI assistant is temporarily unavailable. Please try again.",
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
      message: "Case classification temporarily unavailable.",
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
      message: "Document analysis temporarily unavailable.",
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
      message: "AI lawyer assistant temporarily unavailable.",
    });
  }
};