// backend/src/middleware/stripeWebhookMiddleware.js
//
// CRITICAL: Stripe webhook signature verification requires the RAW (un-parsed)
// request body. Express's express.json() must NOT run before this route.
//
// ─── How to register in server.js ────────────────────────────────────────────
//
//   import paymentRoutes from "./routes/paymentRoutes.js";
//
//   // ⚠️  MUST be before express.json() middleware
//   app.use("/api/payments/webhook", express.raw({ type: "application/json" }), paymentRoutes);
//
//   // Then the rest of your body parsers
//   app.use(express.json());
//
// ─────────────────────────────────────────────────────────────────────────────

import { constructWebhookEvent } from "../services/stripeService.js";

/**
 * Verifies Stripe webhook signature.
 * Attaches the verified event to req.stripeEvent.
 * Returns 400 if the signature is invalid — protects against replay attacks.
 */
export const verifyStripeWebhook = (req, res, next) => {
  const signature = req.headers["stripe-signature"];

  if (!signature) {
    return res.status(400).json({
      success: false,
      message: "Missing stripe-signature header",
    });
  }

  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.error("⚠️  STRIPE_WEBHOOK_SECRET not set in environment");
    return res.status(500).json({ success: false, message: "Webhook not configured" });
  }

  try {
    // req.body must be the raw Buffer here (express.raw middleware must precede this)
    const event = constructWebhookEvent(req.body, signature);
    req.stripeEvent = event;
    next();
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).json({
      success: false,
      message: `Webhook signature error: ${err.message}`,
    });
  }
};