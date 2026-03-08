// backend/src/routes/lawyerRoutes.js
import express from "express";
import { protect, restrictTo }           from "../middleware/authMiddleware.js";
import { getLawyers, getFeaturedLawyers, getLawyerById } from "../controllers/lawyerController.js";
// Profile update lives in profileController so all role saves share one source of truth
import { updateLawyerProfile }           from "../controllers/profileController.js";

const router = express.Router();

// ── Public routes ─────────────────────────────────────────────────
router.get("/",         getLawyers);
router.get("/featured", getFeaturedLawyers);
router.get("/:id",      getLawyerById);

// ── Protected: lawyer updates their own profile ───────────────────
router.put("/profile", protect, restrictTo("lawyer"), updateLawyerProfile);

export default router;