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

// ── Guest chat limiter: /api/ai/public-chat
// No logged-in user to key off, so this is IP-based and stricter than the
// authenticated chat limiter — anonymous traffic has no accountability and
// the same shared Gemini free-tier quota, so it needs a tighter cap to stop
// a single visitor (or a bot) from burning the whole platform's quota.
export const guestChatLimiter = rateLimit({
  windowMs:        5 * 60 * 1000, // 5 minute window
  max:             3,              // 3 messages per IP per 5 min
  keyGenerator:    (req) => ipKeyGenerator(req),
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      message: "You've reached the guest chat limit. Please sign up or log in to continue chatting.",
    });
  },
  standardHeaders: true,
  legacyHeaders:   false,
});