// backend/src/routes/paymentRoutes.js
//
// Mount in server.js:
//
//   import paymentRoutes from "./routes/paymentRoutes.js";
//
//   // ⚠️ Webhook MUST be registered BEFORE express.json() body parser
//   // The webhook route inlines its own express.raw() parser.
//   app.use("/api/payments", paymentRoutes);
//
// The webhook handler takes care of its own raw-body parsing internally.

import express from "express";
import rateLimit from "express-rate-limit";
import { protect }                from "../middleware/authMiddleware.js";
import { clientOnly, adminOnly,
         lawyerOnly }             from "../middleware/roleMiddleware.js";
import { verifyStripeWebhook }    from "../middleware/stripeWebhookMiddleware.js";
import {
  createPaymentIntentHandler,
  handleWebhook,
  getPaymentHistory,
  getPaymentById,
  refundPayment,
  getAdminRevenue,
  getLawyerEarnings,
} from "../controllers/paymentController.js";

const router = express.Router();

// ── Payment-specific rate limiter (tighter than the global API limiter) ──────
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max:      20,              // max 20 payment attempts per 15 min per IP
  message:  "Too many payment requests. Please try again later.",
  standardHeaders: true,
  legacyHeaders:   false,
  skipSuccessfulRequests: false,
});

// ─────────────────────────────────────────────────────────────────────────────
// ⚠️  WEBHOOK — must come BEFORE express.json() body parser
//     Uses express.raw() to preserve raw body for Stripe signature verification
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/webhook",
  express.raw({ type: "application/json" }), // raw body — do NOT change
  verifyStripeWebhook,                        // verify Stripe signature
  handleWebhook                               // process event
);

// ─────────────────────────────────────────────────────────────────────────────
// All routes below this point use the standard JSON body parser
// (already applied globally in server.js AFTER this router is registered)
// ─────────────────────────────────────────────────────────────────────────────

// ── POST /api/payments/create-payment-intent ─────────────────────────────────
// Client initiates payment. Returns clientSecret for Stripe.js frontend.
router.post(
  "/create-payment-intent",
  protect,
  clientOnly,
  paymentLimiter,
  createPaymentIntentHandler
);

// ── GET /api/payments/history ────────────────────────────────────────────────
// Role-aware: clients see their payments, lawyers see received payments, admin sees all.
router.get("/history", protect, getPaymentHistory);

// ── GET /api/payments/admin/revenue ─────────────────────────────────────────
// Admin only: platform revenue dashboard.
router.get("/admin/revenue", protect, adminOnly, getAdminRevenue);

// ── GET /api/payments/lawyer/earnings ────────────────────────────────────────
// Lawyer only: personal earnings summary.
router.get("/lawyer/earnings", protect, lawyerOnly, getLawyerEarnings);

// ── POST /api/payments/:id/refund ────────────────────────────────────────────
// Admin only: issue a full or partial refund.
router.post("/:id/refund", protect, adminOnly, refundPayment);

// ── GET /api/payments/:id ────────────────────────────────────────────────────
// Get a single payment record (party to transaction or admin).
// Keep LAST — /:id catches everything above if mis-ordered.
router.get("/:id", protect, getPaymentById);

export default router;