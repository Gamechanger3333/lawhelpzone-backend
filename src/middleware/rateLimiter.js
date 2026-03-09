import rateLimit from 'express-rate-limit';

// General API rate limiter
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // increased from 100
  message: 'Too many requests from this IP, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

// Auth routes rate limiter
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // increased from 5
  message: 'Too many authentication attempts, please try again later',
  skipSuccessfulRequests: true,
});

// Password reset rate limiter
export const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // increased from 3
  message: 'Too many password reset attempts, please try again later',
});