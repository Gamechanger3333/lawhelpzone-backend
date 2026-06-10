// backend/src/utils/geminiService.js
// Central service for all Gemini API calls.
// Uses gemini-1.5-flash via v1beta — stable, free-tier compatible.

import axios from "axios";

// v1beta/gemini-1.5-flash is the correct stable endpoint for free-tier API keys
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";

const callGemini = async (prompt, retries = 3) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set in environment variables");

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios.post(
        `${GEMINI_URL}?key=${apiKey}`,
        {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 1024,
          },
        },
        {
          headers: { "Content-Type": "application/json" },
          timeout: 30000,
        }
      );
      return response.data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    } catch (err) {
      const status = err?.response?.status;
      console.error(`Gemini attempt ${attempt} failed — status: ${status}, message: ${err.message}`);

      // 404 = wrong model name, do not retry
      if (status === 404) throw new Error(`Gemini model not found (404). Check GEMINI_API_KEY and model name.`);

      const isRetryable = status === 503 || status === 429 || status === 500;
      if (isRetryable && attempt < retries) {
        const delay = attempt * 2000;
        console.log(`Retrying in ${delay / 1000}s...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
};

// ── Feature 1: Legal Assistant (with optional platform context) ───────────────
export const getLegalAssistantReply = async (userMessage, chatHistory = [], platformContext = null) => {
  const historyText = chatHistory
    .slice(-6)
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n");

  let contextBlock = "";
  if (platformContext) {
    contextBlock = `\nPLATFORM CONTEXT (live data):\n${JSON.stringify(platformContext, null, 2)}\nUse this data when the user asks about their cases, statistics, or platform activity.\n`;
  }

  const prompt = `You are an AI assistant for LawHelpZone, a platform connecting clients with lawyers in Pakistan and globally.

RULES:
- You are NOT a licensed lawyer. Never give specific legal advice.
- Always recommend consulting a qualified lawyer for specific situations.
- Keep responses clear and under 300 words.
- Never make up case citations or laws.
- Be helpful, professional, and empathetic.
- If platform context is provided, use actual numbers when answering data questions.
${contextBlock}
${historyText ? `Previous conversation:\n${historyText}\n` : ""}
User: ${userMessage}

Provide a helpful response:`;

  return await callGemini(prompt);
};

// ── Feature 2: Admin AI Assistant (full platform awareness) ──────────────────
export const getAdminAssistantReply = async (userMessage, chatHistory = [], platformContext = {}) => {
  const historyText = chatHistory
    .slice(-8)
    .map((m) => `${m.role === "user" ? "Admin" : "Assistant"}: ${m.content}`)
    .join("\n");

  const contextBlock = `
LIVE PLATFORM DATA:
- Total Users: ${platformContext.totalUsers ?? "N/A"}
- Lawyers: ${platformContext.totalLawyers ?? "N/A"}
- Clients: ${platformContext.totalClients ?? "N/A"}
- Admins: ${platformContext.totalAdmins ?? "N/A"}
- Total Cases: ${platformContext.totalCases ?? "N/A"}
- Open Cases: ${platformContext.openCases ?? "N/A"}
- In-Progress Cases: ${platformContext.inProgressCases ?? "N/A"}
- Cases This Month: ${platformContext.thisMonthCases ?? "N/A"}
`;

  const prompt = `You are an intelligent admin assistant for LawHelpZone, a legal services platform.

YOUR ROLE:
- Answer questions about platform statistics using the live data provided
- Analyze user growth, case trends, and system health
- Suggest operational improvements
- Help with content moderation, broadcast messages, and policy decisions
- Be direct, professional, and data-driven
- Keep responses under 350 words
${contextBlock}
${historyText ? `Previous conversation:\n${historyText}\n` : ""}
Admin: ${userMessage}

Provide a concise, helpful response:`;

  return await callGemini(prompt);
};

// ── Feature 3: Case Classification ───────────────────────────────────────────
export const classifyCase = async (title, description) => {
  const prompt = `You are a legal case classifier. Analyze this case and return ONLY valid JSON — no explanation, no markdown.

Case Title: ${title}
Case Description: ${description}

Return exactly:
{
  "category": "one of: Business Law, Criminal Law, Family Law, Immigration Law, Real Estate Law, Employment Law, Intellectual Property, Corporate Law, Tax Law, Contract Law",
  "urgency": "one of: low, medium, high, urgent",
  "summary": "2-3 sentence plain English summary",
  "recommendedSpecialization": "specific lawyer type needed",
  "keyIssues": ["issue 1", "issue 2", "issue 3"],
  "estimatedComplexity": "one of: simple, moderate, complex",
  "suggestedNextStep": "one actionable sentence for the client"
}`;

  const raw = await callGemini(prompt);
  try {
    return JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch {
    return {
      category: "Business Law",
      urgency: "medium",
      summary: description.slice(0, 150),
      recommendedSpecialization: "General Practice",
      keyIssues: ["Requires professional review"],
      estimatedComplexity: "moderate",
      suggestedNextStep: "Consult a qualified lawyer for a proper assessment.",
    };
  }
};

// ── Feature 4: Document Analysis ─────────────────────────────────────────────
export const analyzeDocument = async (documentText, fileName) => {
  const truncated = documentText.slice(0, 3000);

  const prompt = `You are a legal document analyst. Analyze this document and return ONLY valid JSON — no explanation, no markdown.

Document Name: ${fileName}
Document Content: ${truncated}

Return exactly:
{
  "summary": "3-4 sentence overview",
  "documentType": "e.g. Contract, Agreement, Court Order, Legal Notice",
  "keyPoints": ["point 1", "point 2", "point 3"],
  "parties": ["Party 1 name/role", "Party 2 name/role"],
  "importantDates": ["date and significance"],
  "warnings": ["anything the reader should be careful about"],
  "recommendedAction": "one sentence on what the reader should do next"
}`;

  const raw = await callGemini(prompt);
  try {
    return JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch {
    return {
      summary: "Document analyzed. Please review manually for details.",
      documentType: "Legal Document",
      keyPoints: ["Manual review recommended"],
      parties: [],
      importantDates: [],
      warnings: ["AI could not fully parse this document"],
      recommendedAction: "Have a qualified lawyer review this document.",
    };
  }
};

// ── Feature 5: Lawyer Case Assistant ─────────────────────────────────────────
export const getLawyerCaseAssistance = async (caseTitle, caseDescription, requestType) => {
  const prompts = {
    summarize: `Summarize this legal case in 3-4 clear bullet points for a lawyer's quick review. Be concise and professional.\n\nCase: ${caseTitle}\nDetails: ${caseDescription}`,
    response: `Draft a professional initial response a lawyer could send to a client about their case. Keep it under 150 words. Be professional and empathetic. Do NOT make specific legal promises.\n\nCase: ${caseTitle}\nDetails: ${caseDescription}`,
    tasks: `List 5 specific action items a lawyer should take for this case. Return ONLY a JSON array of strings — no markdown.\n\nCase: ${caseTitle}\nDetails: ${caseDescription}\n\nExample: ["Review documents", "Contact client", ...]`,
  };

  return await callGemini(prompts[requestType] || prompts.summarize);
};

// ── Feature 6: Platform Analytics Insights ───────────────────────────────────
export const getPlatformInsights = async (stats) => {
  const prompt = `You are an AI analytics assistant for LawHelpZone. Analyze these stats and return ONLY valid JSON — no markdown.

Stats:
- Total Users: ${stats.totalUsers}
- Lawyers: ${stats.totalLawyers}
- Clients: ${stats.totalClients}
- Total Cases: ${stats.totalCases}
- Open Cases: ${stats.openCases}
- Cases This Month: ${stats.thisMonthCases}

Return exactly:
{
  "healthScore": 75,
  "headline": "one sentence summarizing platform state",
  "insights": ["insight 1", "insight 2", "insight 3"],
  "alerts": ["concern 1"],
  "recommendations": ["action 1", "action 2", "action 3"],
  "clientLawyerRatio": "description of ratio and whether it is healthy"
}`;

  const raw = await callGemini(prompt);
  try {
    return JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch {
    return {
      healthScore: 75,
      headline: "Platform is operating normally.",
      insights: ["Regular monitoring recommended"],
      alerts: [],
      recommendations: ["Continue regular platform maintenance"],
      clientLawyerRatio: "Ratio appears normal",
    };
  }
};
