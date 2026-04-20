// backend/src/routes/paymentRoutes.js
//
// All routes are prefixed /api/payments in server.js
// ⚠️  The webhook route must receive the RAW body — register it like this in server.js:
//   app.use("/api/payments/webhook", express.raw({ type: "application/json" }));
//   app.use("/api/payments", paymentRoutes);   // after express.json()
import dotenv from 'dotenv';
dotenv.config();
import express from "express";
import Stripe from "stripe";
import User from "../models/User.js";
import Payment from "../models/Payment.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PLATFORM_FEE_PERCENT = 0.20; // 20% to platform, 80% to lawyer

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/payments/stripe/status
// Returns { connected, onboarded } for the authenticated lawyer
// ─────────────────────────────────────────────────────────────────────────────
router.get("/stripe/status", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).lean();
    const accountId = user?.stripeAccountId;

    if (!accountId) {
      return res.json({ connected: false, onboarded: false });
    }

    // Re-check live status from Stripe
    const account = await stripe.accounts.retrieve(accountId);
    const onboarded =
      account.details_submitted &&
      account.charges_enabled &&
      account.payouts_enabled;

    return res.json({
      connected:  true,
      onboarded:  !!onboarded,
      accountId,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
    });
  } catch (err) {
    console.error("Stripe status error:", err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/stripe/connect
// Creates (or reuses) a Stripe Express account and returns an onboarding URL
// ─────────────────────────────────────────────────────────────────────────────
router.post("/stripe/connect", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    let accountId = user.stripeAccountId;

    // Create a new Express account if one doesn't exist
    if (!accountId) {
      const account = await stripe.accounts.create({
        type:  "express",
        email: user.email,
        capabilities: {
          card_payments: { requested: true },
          transfers:     { requested: true },
        },
        metadata: { userId: user._id.toString() },
      });
      accountId = account.id;
      user.stripeAccountId = accountId;
      await user.save();
    }

    const origin = process.env.NEXT_PUBLIC_APP_URL || "https://lawhelpzone-frontend-4fq6.vercel.app";

    const accountLink = await stripe.accountLinks.create({
      account:     accountId,
      refresh_url: `${origin}/dashboard/lawyer/stripe-setup?refresh=true`,
      return_url:  `${origin}/dashboard/lawyer/stripe-setup?success=true`,
      type:        "account_onboarding",
    });

    return res.json({ url: accountLink.url });
  } catch (err) {
    console.error("Stripe connect error:", err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/stripe/dashboard-link
// Returns a Stripe Express dashboard login link for an onboarded lawyer
// ─────────────────────────────────────────────────────────────────────────────
router.post("/stripe/dashboard-link", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).lean();
    if (!user?.stripeAccountId) {
      return res.status(400).json({ success: false, message: "Stripe account not connected" });
    }

    const loginLink = await stripe.accounts.createLoginLink(user.stripeAccountId);
    return res.json({ url: loginLink.url });
  } catch (err) {
    console.error("Dashboard link error:", err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/create-checkout-session
// Client pays a lawyer; money is split via Stripe Connect transfer
// Body: { lawyerId, amount (cents), serviceName, caseId? }
// ─────────────────────────────────────────────────────────────────────────────
router.post("/create-checkout-session", protect, async (req, res) => {
  try {
    const { lawyerId, amount, serviceName = "Legal Service", caseId } = req.body;

    if (!lawyerId || !amount || amount < 50) {
      return res.status(400).json({ success: false, message: "lawyerId and amount (≥50 cents) are required" });
    }

    const lawyer = await User.findById(lawyerId).lean();
    if (!lawyer?.stripeAccountId) {
      return res.status(400).json({ success: false, message: "This lawyer has not connected Stripe yet" });
    }

    const platformFee  = Math.round(amount * PLATFORM_FEE_PERCENT);
    const lawyerAmount = amount - platformFee;

    const origin = process.env.NEXT_PUBLIC_APP_URL || "https://lawhelpzone-frontend-4fq6.vercel.app";

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency:     "usd",
            unit_amount:  amount,
            product_data: { name: serviceName, description: `Legal service with ${lawyer.name}` },
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      payment_intent_data: {
        application_fee_amount: platformFee,
        transfer_data: { destination: lawyer.stripeAccountId },
        metadata: {
          clientId:  req.user._id.toString(),
          lawyerId:  lawyerId.toString(),
          caseId:    caseId || "",
        },
      },
      success_url: `${origin}/dashboard/client/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${origin}/dashboard/client`,
      metadata: {
        clientId:  req.user._id.toString(),
        lawyerId:  lawyerId.toString(),
        caseId:    caseId || "",
      },
    });

    // Create a pending Payment record
    await Payment.create({
      clientId:      req.user._id,
      lawyerId,
      caseId:        caseId || undefined,
      amount,
      platformFee,
      lawyerAmount,
      paymentStatus: "pending",
      description:   serviceName,
      metadata:      { checkoutSessionId: session.id },
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error("Checkout session error:", err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/payments/earnings
// Lawyer's earnings summary + paginated payment history
// ─────────────────────────────────────────────────────────────────────────────
router.get("/earnings", protect, async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const filter = { lawyerId: req.user._id };
    if (status && status !== "all") filter.paymentStatus = status;

    const [payments, total] = await Promise.all([
      Payment.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .populate("clientId", "name email profileImage")
        .populate("caseId",   "title")
        .lean(),
      Payment.countDocuments(filter),
    ]);

    // Aggregate totals
    const [agg] = await Payment.aggregate([
      { $match: { lawyerId: req.user._id } },
      {
        $group: {
          _id: null,
          totalEarned: {
            $sum: { $cond: [{ $eq: ["$paymentStatus", "succeeded"] }, "$lawyerAmount", 0] },
          },
          pendingClearance: {
            $sum: { $cond: [{ $eq: ["$paymentStatus", "pending"] }, "$lawyerAmount", 0] },
          },
          successfulPayments: {
            $sum: { $cond: [{ $eq: ["$paymentStatus", "succeeded"] }, 1, 0] },
          },
        },
      },
    ]);

    return res.json({
      totalEarned:        agg?.totalEarned        ?? 0,
      pendingClearance:   agg?.pendingClearance   ?? 0,
      successfulPayments: agg?.successfulPayments ?? 0,
      payments,
      total,
      page:  Number(page),
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("Earnings fetch error:", err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/webhook   ← raw body, no JSON parsing
// Stripe sends events here; update Payment records accordingly
// ─────────────────────────────────────────────────────────────────────────────
router.post("/webhook", async (req, res) => {
  const sig     = req.headers["stripe-signature"];
  const secret  = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    console.error("Webhook signature failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        await Payment.findOneAndUpdate(
          { "metadata.checkoutSessionId": session.id },
          {
            paymentStatus:          "succeeded",
            stripePaymentIntentId:  session.payment_intent,
            paidAt:                 new Date(),
          }
        );
        break;
      }
      case "payment_intent.payment_failed": {
        const pi = event.data.object;
        await Payment.findOneAndUpdate(
          { stripePaymentIntentId: pi.id },
          {
            paymentStatus:  "failed",
            failureCode:    pi.last_payment_error?.code,
            failureMessage: pi.last_payment_error?.message,
            failedAt:       new Date(),
          }
        );
        break;
      }
      case "charge.refunded": {
        const charge = event.data.object;
        await Payment.findOneAndUpdate(
          { stripeChargeId: charge.id },
          {
            paymentStatus: "refunded",
            refundAmount:  charge.amount_refunded,
            refundedAt:    new Date(),
          }
        );
        break;
      }
      default:
        break;
    }
  } catch (err) {
    console.error("Webhook handler error:", err.message);
    // Still return 200 so Stripe doesn't retry for handler bugs
  }

  return res.json({ received: true });
});


// ─────────────────────────────────────────────────────────────────────────────
// GET /api/payments/history
// Client's payment history (paginated)
// ─────────────────────────────────────────────────────────────────────────────
router.get("/history", protect, async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const filter = { clientId: req.user._id };
    if (status && status !== "all") filter.paymentStatus = status;

    const [payments, total] = await Promise.all([
      Payment.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .populate("lawyerId", "name email profileImage")
        .populate("caseId", "title")
        .lean(),
      Payment.countDocuments(filter),
    ]);

    return res.json({
      payments,
      total,
      page:  Number(page),
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("Payment history error:", err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// GET /api/payments/admin/revenue
// Admin overview: platform revenue, gross volume, payouts + all payments
// ─────────────────────────────────────────────────────────────────────────────
router.get("/admin/revenue", protect, async (req, res) => {
  try {
    // Optional: add admin role check here
    // if (req.user.role !== "admin") return res.status(403).json({ message: "Forbidden" });

    const { period = "month", page = 1, limit = 20, status } = req.query;

    // Build date filter based on period
    const now = new Date();
    let dateFrom;
    if      (period === "week")  dateFrom = new Date(now - 7  * 24 * 60 * 60 * 1000);
    else if (period === "month") dateFrom = new Date(now.getFullYear(), now.getMonth(), 1);
    else if (period === "year")  dateFrom = new Date(now.getFullYear(), 0, 1);
    // "all" → no date filter

    const dateFilter = dateFrom ? { createdAt: { $gte: dateFrom } } : {};
    const statusFilter = status && status !== "all" ? { paymentStatus: status } : {};
    const filter = { ...dateFilter, ...statusFilter };

    // Aggregated stats
    const [agg] = await Payment.aggregate([
      { $match: { ...dateFilter } },
      {
        $group: {
          _id: null,
          platformRevenue: {
            $sum: { $cond: [{ $eq: ["$paymentStatus", "succeeded"] }, "$platformFee", 0] },
          },
          grossVolume: {
            $sum: { $cond: [{ $eq: ["$paymentStatus", "succeeded"] }, "$amount", 0] },
          },
          lawyerPayouts: {
            $sum: { $cond: [{ $eq: ["$paymentStatus", "succeeded"] }, "$lawyerAmount", 0] },
          },
          successfulPayments: {
            $sum: { $cond: [{ $eq: ["$paymentStatus", "succeeded"] }, 1, 0] },
          },
        },
      },
    ]);

    // Paginated payment list
    const [payments, total] = await Promise.all([
      Payment.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .populate("clientId", "name email profileImage")
        .populate("lawyerId", "name email profileImage")
        .populate("caseId",   "title")
        .lean(),
      Payment.countDocuments(filter),
    ]);

    return res.json({
      platformRevenue:    agg?.platformRevenue    ?? 0,
      grossVolume:        agg?.grossVolume         ?? 0,
      lawyerPayouts:      agg?.lawyerPayouts       ?? 0,
      successfulPayments: agg?.successfulPayments  ?? 0,
      payments,
      total,
      page:  Number(page),
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("Admin revenue error:", err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

export default router;