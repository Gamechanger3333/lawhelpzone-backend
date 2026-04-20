// backend/src/routes/authRoutes.js
import express from "express";
import crypto from "crypto";
import User from "../models/User.js";
import {
  createJWT,
  createRefreshToken,
  hashToken,
  verifyRefreshToken,
} from "../utils/security.js";
import {
  validateSignup,
  validateSignin,
  validatePasswordReset,
} from "../middleware/validators.js";
import { authLimiter, passwordResetLimiter } from "../middleware/rateLimiter.js";
import { protect } from "../middleware/authMiddleware.js";
import { sendEmail, emailTemplates } from "../utils/emailService.js";

const router = express.Router();

// ─── Helper: set auth cookies ─────────────────────────────────────────────────
const setAuthCookies = (res, accessToken, refreshToken) => {
  const isProd = process.env.NODE_ENV === "production";

  res.cookie("accessToken", accessToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days (was 15 minutes — caused constant logouts)
  });

  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  });
};

// ─── Helper: safe user object ─────────────────────────────────────────────────
const safeUser = (user) => ({
  _id:          user._id,
  name:         user.name,
  email:        user.email,
  role:         user.role,
  emailVerified: user.emailVerified,
  profileImage: user.profileImage,
});

// ==================== SIGN UP ====================
// POST /api/auth/sign-up
// Frontend sends: { fullName, email, password, confirmPassword, role }
router.post("/sign-up", authLimiter, validateSignup, async (req, res) => {
  try {
    const { fullName, email, password, role } = req.body;

    // Check existing user
    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "Email already registered",
      });
    }

    // Create user  (fullName → name, as per User model)
    const newUser = await User.create({
      name: fullName.trim(),
      email: email.toLowerCase().trim(),
      password,
      role: role || "client",
      emailVerified: false,
    });

    // Generate email verification token
    const verificationToken = newUser.createEmailVerificationToken();
    await newUser.save({ validateBeforeSave: false });

    // Send verification email (non-blocking — don't fail signup if email fails)
    const verificationURL = `${process.env.FRONTEND_URL}/auth/verify-email/${verificationToken}`;
    try {
      const template = emailTemplates.emailVerification({
        name: fullName,
        verificationURL,
      });
      await sendEmail({ to: email, subject: template.subject, html: template.html });
    } catch (emailErr) {
      console.warn("⚠️ Verification email failed (non-fatal):", emailErr.message);
    }

    // Generate tokens
    const accessToken  = createJWT(newUser._id);
    const refreshToken = createRefreshToken(newUser._id);

    // Store hashed refresh token
    newUser.refreshToken = hashToken(refreshToken);
    await newUser.save({ validateBeforeSave: false });

    setAuthCookies(res, accessToken, refreshToken);

    return res.status(201).json({
      success: true,
      message: "Account created! Please check your email to verify.",
      token:   accessToken,
      user:    safeUser(newUser),
    });
  } catch (err) {
    console.error("Sign-up error:", err);
    return res.status(500).json({ success: false, message: "Server error during sign up" });
  }
});

// ==================== LOGIN ====================
// POST /api/auth/login
// Frontend sends: { email, password }
router.post("/login", authLimiter, validateSignin, async (req, res) => {
  try {
    const { email, password } = req.body;

    // Fetch user with password + lock fields
    const user = await User.findOne({ email: email.toLowerCase().trim() }).select(
      "+password +loginAttempts +lockUntil +refreshToken"
    );

    if (!user) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    // Account lock check
    if (user.isLocked) {
      return res.status(423).json({
        success: false,
        message: "Account temporarily locked due to too many failed attempts. Try again in 15 minutes.",
      });
    }

    // Password check
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      user.loginAttempts = (user.loginAttempts || 0) + 1;
      if (user.loginAttempts >= 5) {
        user.lockUntil = Date.now() + 15 * 60 * 1000;
      }
      await user.save({ validateBeforeSave: false });
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    // Suspension check
    if (user.suspended) {
      return res.status(403).json({
        success: false,
        message: `Account suspended: ${user.suspensionReason || "Contact support"}`,
      });
    }

    // Reset lock on successful login
    user.loginAttempts = 0;
    user.lockUntil    = undefined;
    user.lastLogin    = Date.now();
    user.isOnline     = true;

    // Track login history (keep last 10)
    user.loginHistory.push({
      ip:        req.ip || req.connection.remoteAddress,
      userAgent: req.headers["user-agent"],
      loginAt:   new Date(),
    });
    if (user.loginHistory.length > 10) {
      user.loginHistory = user.loginHistory.slice(-10);
    }

    // Generate & store tokens
    const accessToken  = createJWT(user._id);
    const refreshToken = createRefreshToken(user._id);
    user.refreshToken  = hashToken(refreshToken);
    await user.save({ validateBeforeSave: false });

    setAuthCookies(res, accessToken, refreshToken);

    return res.status(200).json({
      success: true,
      message: "Login successful",
      token:   accessToken,
      user:    safeUser(user),
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ success: false, message: "Server error during login" });
  }
});

// ==================== FORGOT PASSWORD ====================
// POST /api/auth/forgot-password
// Frontend sends: { email }
router.post("/forgot-password", passwordResetLimiter, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: "Email is required" });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });

    // Always return success to avoid user enumeration
    if (!user) {
      return res.status(200).json({
        success: true,
        message: "If that email exists, a password reset link has been sent.",
      });
    }

    // Generate reset token
    const resetToken = user.createPasswordResetToken();
    await user.save({ validateBeforeSave: false });

    // Reset URL goes to /auth/reset-password/[token] in Next.js
    const resetURL = `${process.env.FRONTEND_URL}/auth/reset-password/${resetToken}`;

    try {
      const template = emailTemplates.passwordReset({ name: user.name, resetURL });
      await sendEmail({ to: user.email, subject: template.subject, html: template.html });

      return res.status(200).json({
        success: true,
        message: "Password reset email sent!",
      });
    } catch (emailErr) {
      // Rollback token if email fails
      user.passwordResetToken   = undefined;
      user.passwordResetExpires = undefined;
      await user.save({ validateBeforeSave: false });

      console.error("Password reset email error:", emailErr.message);
      return res.status(500).json({
        success: false,
        message: "Error sending password reset email. Please try again.",
      });
    }
  } catch (err) {
    console.error("Forgot password error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ==================== RESET PASSWORD ====================
// POST /api/auth/reset-password/:token
// Frontend sends: { password }
router.post("/reset-password/:token", validatePasswordReset, async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    if (!token) {
      return res.status(400).json({ success: false, message: "Reset token is required" });
    }

    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

    const user = await User.findOne({
      passwordResetToken:   hashedToken,
      passwordResetExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Password reset link is invalid or has expired",
      });
    }

    user.password             = password;
    user.passwordResetToken   = undefined;
    user.passwordResetExpires = undefined;
    user.passwordChangedAt    = Date.now();
    user.refreshToken         = undefined;
    await user.save();

    res.clearCookie("accessToken");
    res.clearCookie("refreshToken");

    return res.status(200).json({
      success: true,
      message: "Password reset successful! Please sign in with your new password.",
    });
  } catch (err) {
    console.error("Reset password error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ==================== VERIFY EMAIL ====================
// GET /api/auth/verify-email/:token
router.get("/verify-email/:token", async (req, res) => {
  try {
    const hashedToken = crypto
      .createHash("sha256")
      .update(req.params.token)
      .digest("hex");

    const user = await User.findOne({
      emailVerificationToken:   hashedToken,
      emailVerificationExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired verification link",
      });
    }

    user.emailVerified              = true;
    user.verified                   = true;
    user.emailVerificationToken     = undefined;
    user.emailVerificationExpires   = undefined;
    await user.save({ validateBeforeSave: false });

    return res.status(200).json({
      success: true,
      message: "Email verified successfully! You can now sign in.",
    });
  } catch (err) {
    console.error("Email verification error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ==================== RESEND VERIFICATION ====================
// POST /api/auth/resend-verification
router.post("/resend-verification", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (user.emailVerified) {
      return res.status(400).json({ success: false, message: "Email already verified" });
    }

    const verificationToken = user.createEmailVerificationToken();
    await user.save({ validateBeforeSave: false });

    const verificationURL = `${process.env.FRONTEND_URL}/auth/verify-email/${verificationToken}`;
    const template = emailTemplates.emailVerification({ name: user.name, verificationURL });
    await sendEmail({ to: user.email, subject: template.subject, html: template.html });

    return res.status(200).json({ success: true, message: "Verification email sent!" });
  } catch (err) {
    console.error("Resend verification error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ==================== REFRESH TOKEN ====================
// POST /api/auth/refresh-token
router.post("/refresh-token", async (req, res) => {
  try {
    const refreshToken = req.cookies?.refreshToken;

    if (!refreshToken) {
      return res.status(401).json({ success: false, message: "No refresh token" });
    }

    const decoded = verifyRefreshToken(refreshToken);
    const user = await User.findById(decoded.id).select("+refreshToken");

    if (!user || user.refreshToken !== hashToken(refreshToken)) {
      return res.status(401).json({ success: false, message: "Invalid refresh token" });
    }

    const newAccessToken = createJWT(user._id);

    res.cookie("accessToken", newAccessToken, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge:   7 * 24 * 60 * 60 * 1000, // 7 days
    });

    return res.status(200).json({ success: true, accessToken: newAccessToken });
  } catch (err) {
    console.error("Refresh token error:", err);
    return res.status(401).json({ success: false, message: "Invalid refresh token" });
  }
});

// ==================== CHECK AUTH ====================
// GET /api/auth/check-auth
router.get("/check-auth", protect, (req, res) => {
  return res.status(200).json({ success: true, user: safeUser(req.user) });
});

// ==================== LOGOUT ====================
// POST /api/auth/logout
router.post("/logout", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (user) {
      user.refreshToken = undefined;
      user.isOnline     = false;
      user.lastSeen     = Date.now();
      await user.save({ validateBeforeSave: false });
    }

    res.clearCookie("accessToken");
    res.clearCookie("refreshToken");

    return res.status(200).json({ success: true, message: "Logged out successfully" });
  } catch (err) {
    console.error("Logout error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

export default router;