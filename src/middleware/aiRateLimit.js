// backend/src/middleware/aiRateLimit.js
// Separate rate limiter for AI endpoints.
// Gemini free tier = 1500 requests/day — this prevents a single user from burning the quota.

import rateLimit, { ipKeyGenerator } from "express-rate-limit";

// ── General AI limiter: classify-case, analyze-document, lawyer-assist, insights
// 8 requests per user per 10 minutes (was 30/hour — too generous for free tier)
export const aiLimiter = rateLimit({
  windowMs:        10 * 60 * 1000, // 10 minute window
  max:             8,               // 8 AI requests per user per 10 min
  keyGenerator:    (req) => req.user?._id?.toString() || ipKeyGenerator(req),
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      message: "AI usage limit reached. Please wait a few minutes before trying again.",
    });
  },
  standardHeaders: true,
  legacyHeaders:   false,
});

// ── Chat limiter: /api/ai/chat and /api/ai/admin-chat
// 4 messages per user per 2 minutes (was 10/min — way too fast for free tier)
export const chatAiLimiter = rateLimit({
  windowMs:        2 * 60 * 1000, // 2 minute window
  max:             4,              // 4 chat messages per 2 min
  keyGenerator:    (req) => req.user?._id?.toString() || ipKeyGenerator(req),
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      message: "Sending too fast. Please wait a moment before sending another message.",
    });
  },
  standardHeaders: true,
  legacyHeaders:   false,
});