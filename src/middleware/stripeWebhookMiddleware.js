// IMPORTANT: This middleware requires the raw (unparsed) request body.
// Register it BEFORE express.json() in server.js:
//
//   app.use("/api/payments/webhook", express.raw({ type: "application/json" }), paymentRoutes);
//   app.use(express.json());

import { constructWebhookEvent } from "../services/stripeService.js";

// Verifies the Stripe webhook signature and attaches the event to req.stripeEvent.
export const verifyStripeWebhook = (req, res, next) => {
  const signature = req.headers["stripe-signature"];

  if (!signature) {
    return res.status(400).json({ success: false, message: "Missing stripe-signature header" });
  }

  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.error("STRIPE_WEBHOOK_SECRET is not set");
    return res.status(500).json({ success: false, message: "Webhook not configured" });
  }

  try {
    req.stripeEvent = constructWebhookEvent(req.body, signature);
    next();
  } catch (err) {
    // Log IP to help detect replay attacks
    console.error(`Webhook signature failed [IP: ${req.ip}]:`, err.message);
    return res.status(400).json({ success: false, message: "Webhook signature verification failed" });
  }
};