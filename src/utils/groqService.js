// backend/src/utils/groqService.js
// Replaces geminiService.js — all AI calls now go through Groq API.
//
// Groq free tier (2026):
//   - 30 requests/minute   (vs Gemini's 15)
//   - 14,400 requests/day  (vs Gemini's ~1,500)
//   - No credit card needed
//   - Sign up: https://console.groq.com
//
// Models used (all free):
//   Primary:  llama-3.1-8b-instant   — fast, low token cost, high RPM
//   Fallback: llama3-70b-8192        — smarter, for complex tasks

import axios from "axios";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

// Primary model first (cheapest on TPM), smarter model as fallback
const MODELS = [
  "llama-3.1-8b-instant",   // 30 RPM, 14400 RPD — workhorse
  "llama3-70b-8192",        // 30 RPM, 14400 RPD — fallback if 8b fails
];

// ── Core Groq caller ──────────────────────────────────────────────────────────
const callGroq = async (systemPrompt, userPrompt, retries = 2) => {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey || apiKey.trim() === "" || apiKey === "gsk_...") {
    throw new Error(
      "GROQ_API_KEY is not configured. Add it to your .env file. Get one free at https://console.groq.com"
    );
  }

  for (const model of MODELS) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await axios.post(
          GROQ_API_URL,
          {
            model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user",   content: userPrompt   },
            ],
            max_tokens:  400,   // keep low to stretch TPM budget
            temperature: 0.3,
          },
          {
            headers: {
              "Content-Type":  "application/json",
              "Authorization": `Bearer ${apiKey}`,
            },
            timeout: 30000,
          }
        );

        const text = response.data?.choices?.[0]?.message?.content;
        if (text) return text.trim();
        throw new Error("Empty response from Groq");

      } catch (err) {
        const status  = err?.response?.status;
        const errMsg  = err?.response?.data?.error?.message || err.message;

        console.error(
          `Groq [${model}] attempt ${attempt}/${retries} failed — status: ${status}, message: ${errMsg}`
        );

        // 401 = bad API key — no point retrying any model
        if (status === 401) {
          throw new Error("Groq API key is invalid. Check GROQ_API_KEY in your .env file.");
        }

        // 400 = bad request — try next model
        if (status === 400) break;

        // 404 = model not found — try next model
        if (status === 404) break;

        // 429 = rate limit — wait then retry
        if (status === 429) {
          // Groq returns retry-after header
          const retryAfter = parseInt(err?.response?.headers?.["retry-after"] || "10", 10);
          const waitMs = Math.min(retryAfter * 1000, 15000); // cap at 15s
          console.log(`Groq rate limit hit. Waiting ${waitMs / 1000}s before retry…`);
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }

        // 500/503 = server error — short wait then retry
        if ((status === 500 || status === 503) && attempt < retries) {
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }

        break; // try next model
      }
    }
  }

  throw new Error("Groq request failed. Please try again in a moment.");
};

// ── Feature 1: Legal Assistant Chat ──────────────────────────────────────────
export const getLegalAssistantReply = async (userMessage, chatHistory = [], platformContext = null) => {
  const historyText = chatHistory
    .slice(-6)
    .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n");

  let contextBlock = "";
  if (platformContext) {
    contextBlock = `\nLIVE PLATFORM DATA:\n${JSON.stringify(platformContext, null, 2)}\nUse this when answering questions about the user's cases or platform stats.\n`;
  }

  const system = `You are an AI assistant for LawHelpZone, a platform connecting clients with lawyers in Pakistan.
RULES:
- You are NOT a licensed lawyer. Never give specific legal advice.
- Always recommend consulting a qualified lawyer for specific situations.
- Keep responses under 250 words. Be clear and concise.
- Never make up case citations or laws.
- Be professional and empathetic.
- Use platform data when provided to answer data questions accurately.
${contextBlock}`;

  const user = historyText
    ? `Previous conversation:\n${historyText}\n\nUser: ${userMessage}`
    : userMessage;

  return await callGroq(system, user);
};

// ── Feature 2: Admin AI Assistant ────────────────────────────────────────────
export const getAdminAssistantReply = async (userMessage, chatHistory = [], platformContext = {}) => {
  const historyText = chatHistory
    .slice(-6)
    .map(m => `${m.role === "user" ? "Admin" : "Assistant"}: ${m.content}`)
    .join("\n");

  const system = `You are an admin assistant for LawHelpZone, a legal services platform.
LIVE PLATFORM DATA:
- Total Users: ${platformContext.totalUsers ?? "N/A"}
- Lawyers: ${platformContext.totalLawyers ?? "N/A"}
- Clients: ${platformContext.totalClients ?? "N/A"}
- Admins: ${platformContext.totalAdmins ?? "N/A"}
- Total Cases: ${platformContext.totalCases ?? "N/A"}
- Open Cases: ${platformContext.openCases ?? "N/A"}
- In-Progress Cases: ${platformContext.inProgressCases ?? "N/A"}
- Cases This Month: ${platformContext.thisMonthCases ?? "N/A"}

YOUR ROLE: Answer questions about stats, analyse trends, suggest improvements. Be direct and data-driven. Keep responses under 300 words.`;

  const user = historyText
    ? `Previous conversation:\n${historyText}\n\nAdmin: ${userMessage}`
    : userMessage;

  return await callGroq(system, user);
};

// ── Feature 3: Case Classification ───────────────────────────────────────────
export const classifyCase = async (title, description) => {
  const system = `You are a legal case classifier. Return ONLY valid JSON — no explanation, no markdown fences.`;

  const user = `Classify this case:
Title: ${title}
Description: ${description}

Return exactly this JSON:
{
  "category": "one of: Business Law, Criminal Law, Family Law, Immigration Law, Real Estate Law, Employment Law, Intellectual Property, Corporate Law, Tax Law, Contract Law",
  "urgency": "one of: low, medium, high, urgent",
  "summary": "2-3 sentence plain English summary",
  "recommendedSpecialization": "specific lawyer type needed",
  "keyIssues": ["issue 1", "issue 2", "issue 3"],
  "estimatedComplexity": "one of: simple, moderate, complex",
  "suggestedNextStep": "one actionable sentence for the client"
}`;

  const raw = await callGroq(system, user);
  try {
    return JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch {
    return {
      category: "General Practice",
      urgency: "medium",
      summary: description.slice(0, 150),
      recommendedSpecialization: "General Practice Lawyer",
      keyIssues: ["Requires professional review"],
      estimatedComplexity: "moderate",
      suggestedNextStep: "Consult a qualified lawyer for a proper assessment.",
    };
  }
};

// ── Feature 4: Document Analysis ─────────────────────────────────────────────
export const analyzeDocument = async (documentText, fileName) => {
  const truncated = documentText.slice(0, 2500); // slightly lower than before to save TPM

  const system = `You are a legal document analyst. Return ONLY valid JSON — no explanation, no markdown fences.`;

  const user = `Analyze this document:
Name: ${fileName}
Content: ${truncated}

Return exactly this JSON:
{
  "summary": "3-4 sentence overview",
  "documentType": "e.g. Contract, Agreement, Court Order, Legal Notice",
  "keyPoints": ["point 1", "point 2", "point 3"],
  "parties": ["Party 1 name/role", "Party 2 name/role"],
  "importantDates": ["date and significance"],
  "warnings": ["anything the reader should be careful about"],
  "recommendedAction": "one sentence on what the reader should do next"
}`;

  const raw = await callGroq(system, user);
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
  const system = `You are a professional legal assistant helping lawyers. Be concise and professional.`;

  const prompts = {
    summarize: `Summarize this legal case in 3-4 clear bullet points for a lawyer's quick review.\n\nCase: ${caseTitle}\nDetails: ${caseDescription}`,
    response:  `Draft a professional initial response (under 120 words) a lawyer could send to a client about their case. Be professional and empathetic. Do NOT make specific legal promises.\n\nCase: ${caseTitle}\nDetails: ${caseDescription}`,
    tasks:     `List 5 specific action items a lawyer should take for this case. Return ONLY a JSON array of strings — no markdown.\n\nCase: ${caseTitle}\nDetails: ${caseDescription}\n\nExample: ["Review documents", "Contact client"]`,
  };

  return await callGroq(system, prompts[requestType] || prompts.summarize);
};

// ── Feature 6: Platform Analytics Insights ───────────────────────────────────
export const getPlatformInsights = async (stats) => {
  const system = `You are an analytics assistant for LawHelpZone. Return ONLY valid JSON — no explanation, no markdown fences.`;

  const user = `Analyze these platform stats:
- Total Users: ${stats.totalUsers}
- Lawyers: ${stats.totalLawyers}
- Clients: ${stats.totalClients}
- Total Cases: ${stats.totalCases}
- Open Cases: ${stats.openCases}
- Cases This Month: ${stats.thisMonthCases}

Return exactly this JSON:
{
  "healthScore": 75,
  "headline": "one sentence summarizing platform state",
  "insights": ["insight 1", "insight 2", "insight 3"],
  "alerts": ["concern 1"],
  "recommendations": ["action 1", "action 2", "action 3"],
  "clientLawyerRatio": "description of ratio and whether it is healthy"
}`;

  const raw = await callGroq(system, user);
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