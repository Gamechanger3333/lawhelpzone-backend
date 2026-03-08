// backend/src/middleware/authMiddleware.js
// Single unified auth middleware — replaces protect.js, auth.js, authMiddleware.js
import jwt from "jsonwebtoken";
import User from "../models/User.js";

// ─── protect ──────────────────────────────────────────────────────────────────
// Verifies accessToken from cookie or Authorization header.
// Attaches req.user for downstream handlers.
export const protect = async (req, res, next) => {
  try {
    // 1. Try httpOnly cookie first (set by login/signup)
    let token = req.cookies?.accessToken;

    // 2. Fallback: Bearer token in Authorization header (API / mobile clients)
    if (!token && req.headers.authorization?.startsWith("Bearer ")) {
      token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Not authenticated. Please sign in.",
      });
    }

    // Verify the token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Fetch user (exclude sensitive fields)
    const user = await User.findById(decoded.id).select(
      "-password -refreshToken -passwordResetToken -emailVerificationToken"
    );

    if (!user) {
      return res.status(401).json({ success: false, message: "User no longer exists" });
    }

    // Check if account is active
    if (!user.active) {
      return res.status(401).json({ success: false, message: "Account has been deactivated" });
    }

    // Check if account is suspended
    if (user.suspended) {
      return res.status(403).json({
        success: false,
        message: `Account suspended: ${user.suspensionReason || "Contact support"}`,
      });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Session expired. Please sign in again.",
        code: "TOKEN_EXPIRED",
      });
    }
    if (err.name === "JsonWebTokenError") {
      return res.status(401).json({
        success: false,
        message: "Invalid token. Please sign in again.",
      });
    }
    console.error("Auth middleware error:", err.message);
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
};

// ─── restrictTo ───────────────────────────────────────────────────────────────
// Role-based access control. Use after protect.
// Example: router.get("/admin-only", protect, restrictTo("admin"), handler)
export const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required role: ${roles.join(" or ")}`,
      });
    }
    next();
  };
};

// ─── optionalAuth ─────────────────────────────────────────────────────────────
// Attaches user if token present but does NOT block unauthenticated requests.
// Useful for routes that work for both guests and logged-in users.
export const optionalAuth = async (req, res, next) => {
  try {
    let token = req.cookies?.accessToken;
    if (!token && req.headers.authorization?.startsWith("Bearer ")) {
      token = req.headers.authorization.split(" ")[1];
    }
    if (!token) return next();

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select("-password -refreshToken");
    if (user) req.user = user;
  } catch {
    // Token invalid or expired — just skip, don't block
  }
  next();
};