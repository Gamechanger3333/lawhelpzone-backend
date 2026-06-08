// backend/src/utils/geminiService.js
// Central service for all Gemini API calls.
// All AI features in this project use this file — never call Gemini directly.

import axios from "axios";

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent";

const callGemini = async (prompt, retries = 3) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set in environment variables");

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios.post(
        `${GEMINI_API_URL}?key=${apiKey}`,
        {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature:     0.3,
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
      const isRetryable = status === 503 || status === 429 || status === 500;

      if (isRetryable && attempt < retries) {
        const delay = attempt * 2000; // 2s, 4s
        console.log(`Gemini ${status} — retrying in ${delay/1000}s (attempt ${attempt}/${retries})`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
};

// ── Feature 1: Legal Assistant ────────────────────────────────────────────────
export const getLegalAssistantReply = async (userMessage, chatHistory = []) => {
  const historyText = chatHistory
    .slice(-6)
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n");

  const prompt = `You are an AI legal information assistant for LawHelpZone, a platform that connects clients with lawyers in Pakistan and globally.

STRICT RULES:
- You are NOT a licensed lawyer. Never give specific legal advice.
- Always recommend consulting a qualified lawyer for specific situations.
- Keep responses clear, simple, and under 200 words.
- If asked about Pakistani law specifically, mention that laws vary and a local lawyer should be consulted.
- Never make up case citations or laws.
- Be helpful, professional, and empathetic.

${historyText ? `Previous conversation:\n${historyText}\n` : ""}
User: ${userMessage}

Provide a helpful informational response:`;

  return await callGemini(prompt);
};

// ── Feature 2: Case Classification ───────────────────────────────────────────
export const classifyCase = async (title, description) => {
  const prompt = `You are a legal case classifier. Analyze this legal case and return ONLY a valid JSON object — no explanation, no markdown, no code blocks.

Case Title: ${title}
Case Description: ${description}

Return this exact JSON structure:
{
  "category": "one of: Business Law, Criminal Law, Family Law, Immigration Law, Real Estate Law, Employment Law, Intellectual Property, Corporate Law, Tax Law, Contract Law",
  "urgency": "one of: low, medium, high, urgent",
  "summary": "2-3 sentence plain English summary of the case",
  "recommendedSpecialization": "specific lawyer type needed",
  "keyIssues": ["issue 1", "issue 2", "issue 3"],
  "estimatedComplexity": "one of: simple, moderate, complex",
  "suggestedNextStep": "one actionable sentence for the client"
}`;

  const raw = await callGemini(prompt);

  try {
    const cleaned = raw.replace(/```json|```/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    return {
      category:                  "Business Law",
      urgency:                   "medium",
      summary:                   description.slice(0, 150),
      recommendedSpecialization: "General Practice",
      keyIssues:                 ["Requires professional review"],
      estimatedComplexity:       "moderate",
      suggestedNextStep:         "Consult a qualified lawyer for a proper assessment.",
    };
  }
};

// ── Feature 3: Document Analysis ─────────────────────────────────────────────
export const analyzeDocument = async (documentText, fileName) => {
  const truncated = documentText.slice(0, 3000);

  const prompt = `You are a legal document analyst. Analyze this document and return ONLY a valid JSON object — no explanation, no markdown, no code blocks.

Document Name: ${fileName}
Document Content: ${truncated}

Return this exact JSON structure:
{
  "summary": "3-4 sentence overview of what this document is about",
  "documentType": "e.g. Contract, Agreement, Court Order, Legal Notice, etc.",
  "keyPoints": ["important point 1", "important point 2", "important point 3"],
  "parties": ["Party 1 name/role", "Party 2 name/role"],
  "importantDates": ["date and its significance"],
  "warnings": ["anything the reader should be careful about"],
  "recommendedAction": "one sentence on what the reader should do next"
}`;

  const raw = await callGemini(prompt);

  try {
    const cleaned = raw.replace(/```json|```/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    return {
      summary:           "Document analyzed. Please review manually for details.",
      documentType:      "Legal Document",
      keyPoints:         ["Manual review recommended"],
      parties:           [],
      importantDates:    [],
      warnings:          ["AI could not fully parse this document"],
      recommendedAction: "Have a qualified lawyer review this document.",
    };
  }
};

// ── Feature 4: Lawyer Case Assistant ─────────────────────────────────────────
export const getLawyerCaseAssistance = async (caseTitle, caseDescription, requestType) => {
  const prompts = {
    summarize: `Summarize this legal case in 3-4 clear bullet points for a lawyer's quick review. Be concise and professional.

Case: ${caseTitle}
Details: ${caseDescription}`,

    response: `Draft a professional initial response a lawyer could send to a client about their case. Keep it under 150 words. Be professional and empathetic. Do NOT make specific legal promises.

Case: ${caseTitle}
Details: ${caseDescription}`,

    tasks: `List 5 specific action items a lawyer should take for this case. Return ONLY a JSON array of strings — no markdown, no explanation.

Case: ${caseTitle}
Details: ${caseDescription}

Example format: ["Review documents", "Contact client", ...]`,
  };

  const prompt = prompts[requestType] || prompts.summarize;
  return await callGemini(prompt);
};