// backend/src/middleware/aiRateLimit.js
// Separate rate limiter for AI endpoints.
// Gemini free tier = 1500 requests/day — this prevents a single user from burning the quota.

import rateLimit, { ipKeyGenerator } from "express-rate-limit";

export const aiLimiter = rateLimit({
  windowMs:        60 * 60 * 1000, // 1 hour window
  max:             30,              // 30 AI requests per user per hour
  keyGenerator:    (req) => req.user?._id?.toString() || ipKeyGenerator(req),
  message:         { success: false, message: "Too many AI requests. Please wait before trying again." },
  standardHeaders: true,
  legacyHeaders:   false,
});

export const chatAiLimiter = rateLimit({
  windowMs:        60 * 1000, // 1 minute window
  max:             10,        // 10 chat messages per minute
  keyGenerator:    (req) => req.user?._id?.toString() || ipKeyGenerator(req),
  message:         { success: false, message: "Sending too fast. Please slow down." },
  standardHeaders: true,
  legacyHeaders:   false,
});