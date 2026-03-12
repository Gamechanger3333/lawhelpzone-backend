// backend/src/routes/stripeRoutes.js
//
// All Stripe Connect routes for lawyer onboarding.
// Mount: app.use("/api/stripe", stripeRoutes)

import express from "express";
import { protect }    from "../middleware/authMiddleware.js";
import { lawyerOnly } from "../middleware/roleMiddleware.js";
import {
  connectAccount,
  getAccountStatus,
  getDashboardLink,
  refreshOnboardingLink,
} from "../controllers/stripeController.js";

const router = express.Router();

// All routes require authentication
router.use(protect);

// ── POST /api/stripe/connect-account ─────────────────────────────────────────
// Lawyer starts Stripe onboarding. Returns hosted onboarding URL.
router.post("/connect-account", lawyerOnly, connectAccount);

// ── GET /api/stripe/account-status ───────────────────────────────────────────
// Check if lawyer's Stripe account is fully onboarded.
// Frontend calls this on return from Stripe onboarding flow.
router.get("/account-status", lawyerOnly, getAccountStatus);

// ── GET /api/stripe/dashboard-link ───────────────────────────────────────────
// Get one-time login link for the Stripe Express dashboard.
// Lawyers use this to view payouts and tax forms.
router.get("/dashboard-link", lawyerOnly, getDashboardLink);

// ── GET /api/stripe/refresh ───────────────────────────────────────────────────
// Re-generate onboarding link if the previous one expired.
router.get("/refresh", lawyerOnly, refreshOnboardingLink);

export default router;