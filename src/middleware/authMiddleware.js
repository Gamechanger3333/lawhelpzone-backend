import jwt  from "jsonwebtoken";
import User from "../models/User.js";

// Verifies accessToken from cookie or Authorization header.
// Attaches req.user for downstream handlers.
export const protect = async (req, res, next) => {
  try {
    let token = req.cookies?.accessToken;

    if (!token && req.headers.authorization?.startsWith("Bearer ")) {
      token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
      return res.status(401).json({ success: false, message: "Not authenticated. Please sign in." });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id).select(
      "-password -refreshToken -passwordResetToken -emailVerificationToken"
    );

    if (!user)           return res.status(401).json({ success: false, message: "User no longer exists" });
    if (!user.active)    return res.status(401).json({ success: false, message: "Account has been deactivated" });
    if (user.suspended)  return res.status(403).json({ success: false, message: `Account suspended: ${user.suspensionReason || "Contact support"}` });

    req.user = user;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ success: false, message: "Session expired. Please sign in again.", code: "TOKEN_EXPIRED" });
    }
    if (err.name === "JsonWebTokenError") {
      return res.status(401).json({ success: false, message: "Invalid token. Please sign in again." });
    }
    console.error("Auth middleware error:", err.message);
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
};

// Role-based access control. Use after protect.
// Example: router.get("/admin-only", protect, restrictTo("admin"), handler)
export const restrictTo = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user?.role)) {
    return res.status(403).json({ success: false, message: `Access denied. Required role: ${roles.join(" or ")}` });
  }
  next();
};

// Attaches user if token present but does NOT block unauthenticated requests.
export const optionalAuth = async (req, res, next) => {
  try {
    let token = req.cookies?.accessToken;
    if (!token && req.headers.authorization?.startsWith("Bearer ")) {
      token = req.headers.authorization.split(" ")[1];
    }
    if (!token) return next();

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user    = await User.findById(decoded.id).select("-password -refreshToken");
    if (user) req.user = user;
  } catch (err) {
    // Only silence expected token errors — log anything unexpected
    if (!["TokenExpiredError", "JsonWebTokenError"].includes(err.name)) {
      console.error("optionalAuth unexpected error:", err.message);
    }
  }
  next();
};