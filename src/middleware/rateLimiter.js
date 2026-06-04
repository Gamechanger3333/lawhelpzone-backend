import rateLimit from "express-rate-limit";

// General API limiter — applied to all /api routes
export const apiLimiter = rateLimit({
  windowMs:       15 * 60 * 1000,
  max:            500,
  message:        "Too many requests from this IP, please try again later",
  standardHeaders: true,
  legacyHeaders:  false,
});

// Auth routes — login / signup / token refresh
export const authLimiter = rateLimit({
  windowMs:              15 * 60 * 1000,
  max:                   50,
  message:               "Too many authentication attempts, please try again later",
  skipSuccessfulRequests: true,
});

// Password reset — tighter window to limit abuse
export const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max:      10,
  message:  "Too many password reset attempts, please try again later",
});

// Payment intent creation — prevents spam charges
export const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      10,
  message:  "Too many payment requests, please try again later",
});