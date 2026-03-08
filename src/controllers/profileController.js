// backend/src/controllers/profileController.js
// Handles GET /api/auth/me and all PUT /profile endpoints (per role).
// Imported by profileRoutes.js and lawyerRoutes.js.
import User from "../models/User.js";

// ─── helpers ──────────────────────────────────────────────────────
const pick = (obj, keys) =>
  keys.reduce((acc, k) => {
    if (obj[k] !== undefined) acc[k] = obj[k];
    return acc;
  }, {});

const safeUser = (user) => {
  const u = user.toObject ? user.toObject() : user;
  delete u.password;
  delete u.refreshToken;
  delete u.passwordResetToken;
  delete u.emailVerificationToken;
  return u;
};

// Fields every role can update on the root User document
const PERSONAL_FIELDS = [
  "name", "phone", "bio", "city", "country",
  "address", "dob", "gender", "nationalId", "profileImage",
];

// Fields inside lawyerProfile sub-document
const LAWYER_SUB_FIELDS = [
  "barNumber", "barCouncil", "jurisdiction",
  "yearsOfExperience", "hourlyRate", "currency", "consultationFee",
  "isAvailable", "totalCasesHandled", "successRate",
  "education", "university", "graduationYear",
  "officeAddress", "website", "linkedIn",
  "specializations", "languages", "courts",
];

// Fields inside clientProfile sub-document
const CLIENT_SUB_FIELDS = [
  "legalNeeds", "preferredLanguage", "occupation",
  "employer", "income", "emergencyContact", "notes",
];

// Admin-only root fields
const ADMIN_FIELDS = ["department", "employeeId", "supervisor"];

// ═══════════════════════════════════════════════════════════════════
// GET /api/auth/me
// ═══════════════════════════════════════════════════════════════════
export const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    res.json({ success: true, user: safeUser(user) });
  } catch (err) {
    console.error("getMe error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ═══════════════════════════════════════════════════════════════════
// PUT /api/auth/profile  — universal fallback (respects req.user.role)
// ═══════════════════════════════════════════════════════════════════
export const updateProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    // Apply personal fields
    Object.assign(user, pick(req.body, PERSONAL_FIELDS));

    // Apply role-specific sub-document
    if (user.role === "lawyer") _applyLawyerFields(user, req.body);
    if (user.role === "client") _applyClientFields(user, req.body);
    if (user.role === "admin")  Object.assign(user, pick(req.body, ADMIN_FIELDS));

    await user.save({ validateBeforeSave: false });

    res.json({
      success: true,
      message: "Profile updated successfully",
      user:    safeUser(user),
    });
  } catch (err) {
    console.error("updateProfile error:", err);
    res.status(500).json({ success: false, message: "Failed to update profile" });
  }
};

// ═══════════════════════════════════════════════════════════════════
// PUT /api/clients/profile  — client only
// ═══════════════════════════════════════════════════════════════════
export const updateClientProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    Object.assign(user, pick(req.body, PERSONAL_FIELDS));
    _applyClientFields(user, req.body);

    await user.save({ validateBeforeSave: false });

    res.json({
      success: true,
      message: "Client profile updated",
      user:    safeUser(user),
    });
  } catch (err) {
    console.error("updateClientProfile error:", err);
    res.status(500).json({ success: false, message: "Failed to update client profile" });
  }
};

// ═══════════════════════════════════════════════════════════════════
// PUT /api/lawyers/profile  — lawyer only
// (also exported so lawyerRoutes.js can import it directly)
// ═══════════════════════════════════════════════════════════════════
export const updateLawyerProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    Object.assign(user, pick(req.body, PERSONAL_FIELDS));
    _applyLawyerFields(user, req.body);

    await user.save({ validateBeforeSave: false });

    res.json({
      success: true,
      message: "Lawyer profile updated",
      user:    safeUser(user),
    });
  } catch (err) {
    console.error("updateLawyerProfile error:", err);
    res.status(500).json({ success: false, message: "Failed to update lawyer profile" });
  }
};

// ═══════════════════════════════════════════════════════════════════
// PUT /api/admin/profile  — admin only
// ═══════════════════════════════════════════════════════════════════
export const updateAdminProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    Object.assign(user, pick(req.body, PERSONAL_FIELDS));
    Object.assign(user, pick(req.body, ADMIN_FIELDS));

    await user.save({ validateBeforeSave: false });

    res.json({
      success: true,
      message: "Admin profile updated",
      user:    safeUser(user),
    });
  } catch (err) {
    console.error("updateAdminProfile error:", err);
    res.status(500).json({ success: false, message: "Failed to update admin profile" });
  }
};

// ═══════════════════════════════════════════════════════════════════
// Private helpers — merge sub-document fields onto user
// ═══════════════════════════════════════════════════════════════════

function _applyLawyerFields(user, body) {
  // Accept fields at the root level OR nested under lawyerProfile: {}
  const src = body.lawyerProfile || body;
  const updates = pick(src, LAWYER_SUB_FIELDS);
  if (Object.keys(updates).length === 0) return;

  // Merge into embedded sub-document (Mongoose needs direct assignment on mixed)
  user.lawyerProfile = { ...user.lawyerProfile.toObject?.() ?? user.lawyerProfile, ...updates };
  user.markModified("lawyerProfile");
}

function _applyClientFields(user, body) {
  const src = body.clientProfile || body;
  const updates = pick(src, CLIENT_SUB_FIELDS);
  if (Object.keys(updates).length === 0) return;

  user.clientProfile = { ...user.clientProfile.toObject?.() ?? user.clientProfile, ...updates };
  user.markModified("clientProfile");
}