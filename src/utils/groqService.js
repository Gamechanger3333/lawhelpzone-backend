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
import User from "../models/User.js";
import Case from "../models/Case.js";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

// ── Tool definitions (OpenAI-compatible function calling, supported by Groq) ──
const TOOLS = [
  {
    type: "function",
    function: {
      name: "searchLawyers",
      description: "Search registered lawyers on the platform by specialization, location, or availability.",
      parameters: {
        type: "object",
        properties: {
          specialization: { type: "string", description: "e.g. Family Law, Criminal Law" },
          location:       { type: "string", description: "City or jurisdiction" },
          minRating:      { type: "number", description: "Minimum rating 0-5" },
          onlyAvailable:  { type: "boolean", description: "Only return lawyers currently available" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "searchCases",
      description: "Search legal cases on the platform by category, status, or location. Results are automatically scoped to what the requesting user is allowed to see.",
      parameters: {
        type: "object",
        properties: {
          category: { type: "string", description: "e.g. Family Law, Business Law" },
          status:   { type: "string", enum: ["open", "in-progress", "closed", "cancelled"] },
          location: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getLawyerProfile",
      description: "Get detailed profile information for a specific lawyer by name or email.",
      parameters: {
        type: "object",
        properties: {
          nameOrEmail: { type: "string", description: "Lawyer's name or email to look up" },
        },
        required: ["nameOrEmail"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "searchClients",
      description: "Search registered clients on the platform by name or email. Admin only.",
      parameters: {
        type: "object",
        properties: {
          nameOrEmail: { type: "string", description: "Client's name or email to search for" },
        },
      },
    },
  },
];

// ── Tool handlers — actual DB queries, scoped by requesting user ──────────────
const MAX_RESULTS = 10;

const toolHandlers = {
  searchLawyers: async ({ specialization, location, minRating, onlyAvailable }) => {
    const filter = { role: "lawyer" };
    if (specialization) filter["lawyerProfile.specializations"] = { $regex: specialization, $options: "i" };
    if (location) filter["lawyerProfile.jurisdiction"] = { $regex: location, $options: "i" };
    if (minRating) filter["lawyerProfile.rating"] = { $gte: minRating };
    if (onlyAvailable) filter["lawyerProfile.isAvailable"] = true;

    const lawyers = await User.find(filter)
      .select("name email lawyerProfile.specializations lawyerProfile.jurisdiction lawyerProfile.rating lawyerProfile.hourlyRate lawyerProfile.isAvailable lawyerProfile.yearsOfExperience")
      .limit(MAX_RESULTS)
      .lean();

    return lawyers.map(l => ({
      name: l.name,
      email: l.email,
      specializations: l.lawyerProfile?.specializations,
      jurisdiction: l.lawyerProfile?.jurisdiction,
      rating: l.lawyerProfile?.rating,
      hourlyRate: l.lawyerProfile?.hourlyRate,
      isAvailable: l.lawyerProfile?.isAvailable,
      yearsOfExperience: l.lawyerProfile?.yearsOfExperience,
    }));
  },

  searchCases: async ({ category, status, location }, requester) => {
    const filter = {};
    if (category) filter.category = category;
    if (status) filter.status = status;
    if (location) filter.location = { $regex: location, $options: "i" };

    // Scope by role — clients/lawyers only see their own cases; admins see all
    if (requester?.role === "client") {
      filter.clientId = requester._id;
    } else if (requester?.role === "lawyer") {
      filter.$or = [{ assignedLawyerId: requester._id }, { status: "open" }];
    }

    const cases = await Case.find(filter)
      .select("title category status location country budget deadline urgency")
      .sort({ createdAt: -1 })
      .limit(MAX_RESULTS)
      .lean();

    return cases;
  },

  getLawyerProfile: async ({ nameOrEmail }) => {
    const lawyer = await User.findOne({
      role: "lawyer",
      $or: [
        { name: { $regex: nameOrEmail, $options: "i" } },
        { email: { $regex: nameOrEmail, $options: "i" } },
      ],
    })
      .select("name email lawyerProfile")
      .lean();

    if (!lawyer) return { error: "No lawyer found matching that name or email." };
    return { name: lawyer.name, email: lawyer.email, profile: lawyer.lawyerProfile };
  },

  searchClients: async ({ nameOrEmail }, requester) => {
    if (requester?.role !== "admin") return { error: "Not authorized" };
    const filter = { role: "client" };
    if (nameOrEmail) {
      filter.$or = [
        { name: { $regex: nameOrEmail, $options: "i" } },
        { email: { $regex: nameOrEmail, $options: "i" } },
      ];
    }
    const clients = await User.find(filter)
      .select("name email createdAt")
      .limit(MAX_RESULTS)
      .lean();
    return clients;
  },
};

// ── Tool-calling wrapper around Groq ───────────────────────────────────────
const callGroqWithTools = async (systemPrompt, userPrompt, requester = null, retries = 2) => {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey || apiKey.trim() === "" || apiKey === "gsk_...") {
    throw new Error(
      "GROQ_API_KEY is not configured. Add it to your .env file. Get one free at https://console.groq.com"
    );
  }

  let messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  for (const model of TOOL_MODELS) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await axios.post(
          GROQ_API_URL,
          {
            model,
            messages,
            tools: TOOLS,
            tool_choice: "auto",
            max_tokens: 500,
            temperature: 0.3,
          },
          {
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${apiKey}`,
            },
            timeout: 30000,
          }
        );

        const choice = response.data?.choices?.[0];
        const msg = choice?.message;

        // If the model wants to call tools, execute them and loop back
        if (msg?.tool_calls?.length) {
          messages.push(msg);

          for (const call of msg.tool_calls) {
            const fnName = call.function?.name;
            const handler = toolHandlers[fnName];
            let result;
            try {
              const args = JSON.parse(call.function?.arguments || "{}");
              result = handler ? await handler(args, requester) : { error: "Unknown tool" };
            } catch (e) {
              result = { error: e.message };
            }

            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: JSON.stringify(result),
            });
          }

          // Re-call the same model with tool results appended
          const followUp = await axios.post(
            GROQ_API_URL,
            { model, messages, max_tokens: 500, temperature: 0.3 },
            {
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
              timeout: 30000,
            }
          );
          const finalText = followUp.data?.choices?.[0]?.message?.content;
          if (finalText) return finalText.trim();
          throw new Error("Empty response from Groq after tool call");
        }

        if (msg?.content) return msg.content.trim();
        throw new Error("Empty response from Groq");

      } catch (err) {
        const status = err?.response?.status;
        const errMsg = err?.response?.data?.error?.message || err.message;

        console.error(`Groq [${model}] attempt ${attempt}/${retries} failed — status: ${status}, message: ${errMsg}`);

        if (status === 401) {
          throw new Error("Groq API key is invalid. Check GROQ_API_KEY in your .env file.");
        }
        if (status === 400 || status === 404) break;
        if (status === 429) {
          const retryAfter = parseInt(err?.response?.headers?.["retry-after"] || "10", 10);
          const waitMs = Math.min(retryAfter * 1000, 15000);
          console.log(`Groq rate limit hit. Waiting ${waitMs / 1000}s before retry…`);
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }
        if ((status === 500 || status === 503) && attempt < retries) {
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }
        break;
      }
    }
  }

  throw new Error("Groq request failed. Please try again in a moment.");
};

// Primary model first (cheapest on TPM), smarter model as fallback
const MODELS = [
  "llama-3.1-8b-instant",   // 30 RPM, 14400 RPD — workhorse
  "llama3-70b-8192",        // 30 RPM, 14400 RPD — fallback if 8b fails
];

// Tool-calling needs a model that reliably honors function-call requests.
// llama-3.1-8b-instant often skips tools and hallucinates instead — use
// larger models first for any request that may need DB lookups.
const TOOL_MODELS = [
  "llama-3.3-70b-versatile",
  "llama3-70b-8192",
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
export const getLegalAssistantReply = async (userMessage, chatHistory = [], platformContext = null, requester = null) => {
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
- You have tools to search lawyers, cases, and lawyer profiles on the platform. You MUST call the relevant tool whenever the user asks to find/list/search lawyers, cases, pricing, or specializations — NEVER invent names, lawyers, or data from memory. If a tool returns no results or an error, say so honestly instead of making something up.
${contextBlock}`;

  const user = historyText
    ? `Previous conversation:\n${historyText}\n\nUser: ${userMessage}`
    : userMessage;

  return await callGroqWithTools(system, user, requester);
};

// ── Feature 2: Admin AI Assistant ────────────────────────────────────────────
export const getAdminAssistantReply = async (userMessage, chatHistory = [], platformContext = {}, requester = null) => {
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

YOUR ROLE: Answer questions about stats, analyse trends, suggest improvements. You have admin-level tools to search/list lawyers, clients, and cases across the entire platform (no scoping restrictions) — you MUST call the relevant tool whenever asked to find, list, or look up lawyers, clients, or cases. NEVER invent names or data from memory; if a tool returns no results or an error, say so honestly. Be direct and data-driven. Keep responses under 300 words.`;

  const user = historyText
    ? `Previous conversation:\n${historyText}\n\nAdmin: ${userMessage}`
    : userMessage;

  return await callGroqWithTools(system, user, requester);
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