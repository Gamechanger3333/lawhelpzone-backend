// backend/src/controllers/paymentController.js
//
// Handles all payment lifecycle events:
//   - Creating PaymentIntents (with fee split)
//   - Stripe webhook processing
//   - Payment history queries
//   - Refunds (admin)
//   - Admin revenue dashboard

import Payment from "../models/Payment.js";
import User    from "../models/User.js";
import Case    from "../models/Case.js";
import { calculateFees }         from "../utils/feeCalculator.js";
import { createPaymentIntent,
         retrievePaymentIntent,
         cancelPaymentIntent,
         constructWebhookEvent,
         createRefund }           from "../services/stripeService.js";
import { createNotification }     from "../routes/notificationRoutes.js";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/create-payment-intent
// Called by client to start a payment. Returns clientSecret for Stripe.js.
// ─────────────────────────────────────────────────────────────────────────────
export const createPaymentIntentHandler = async (req, res) => {
  try {
    const { caseId, lawyerId, amount, description } = req.body;
    const clientId = req.user._id;

    // ── 1. Validate inputs ───────────────────────────────────────────────────
    if (!lawyerId || !amount) {
      return res.status(400).json({
        success: false,
        message: "lawyerId and amount are required",
      });
    }

    // ── 2. Validate lawyer exists + has connected Stripe account ─────────────
    const lawyer = await User.findOne({ _id: lawyerId, role: "lawyer" });

    if (!lawyer) {
      return res.status(404).json({
        success: false,
        message: "Lawyer not found",
      });
    }

    if (!lawyer.lawyerProfile?.stripeAccountId) {
      return res.status(400).json({
        success: false,
        message: "This lawyer has not connected their Stripe account yet. Please choose another lawyer or ask them to complete payment setup.",
      });
    }

    if (!lawyer.lawyerProfile?.stripeOnboarded) {
      return res.status(400).json({
        success: false,
        message: "This lawyer's payment account is not fully set up yet.",
      });
    }

    // ── 3. Validate case if provided ──────────────────────────────────────────
    let caseDoc = null;
    if (caseId) {
      caseDoc = await Case.findById(caseId);
      if (!caseDoc) {
        return res.status(404).json({ success: false, message: "Case not found" });
      }
      // Client must own the case
      if (String(caseDoc.clientId) !== String(clientId)) {
        return res.status(403).json({
          success: false,
          message: "You do not own this case",
        });
      }
    }

    // ── 4. Server-side fee calculation (NEVER trust frontend amounts) ─────────
    let fees;
    try {
      fees = calculateFees(amount);
    } catch (feeErr) {
      return res.status(400).json({ success: false, message: feeErr.message });
    }

    const { amountCents, platformFeeCents, lawyerAmountCents } = fees;

    // ── 5. Create Stripe PaymentIntent ───────────────────────────────────────
    const intent = await createPaymentIntent({
      amountCents,
      platformFeeCents,
      lawyerStripeAccountId: lawyer.lawyerProfile.stripeAccountId,
      currency:    "usd",
      description: description || `Legal service payment to ${lawyer.name}`,
      metadata: {
        clientId:  String(clientId),
        lawyerId:  String(lawyerId),
        caseId:    caseId ? String(caseId) : "",
        platform:  "lawhelpzone",
      },
    });

    // ── 6. Persist pending payment record ────────────────────────────────────
    const payment = await Payment.create({
      clientId,
      lawyerId,
      caseId:                caseId  || undefined,
      amount:                amountCents,
      platformFee:           platformFeeCents,
      lawyerAmount:          lawyerAmountCents,
      currency:              "usd",
      stripePaymentIntentId: intent.id,
      paymentStatus:         "pending",
      description:           description || `Payment to ${lawyer.name}`,
      metadata: {
        caseTitle: caseDoc?.title || "",
        lawyerName: lawyer.name,
        clientName: req.user.name,
      },
    });

    // ── 7. Respond with clientSecret (Stripe.js uses this to confirm payment) ─
    return res.status(201).json({
      success:      true,
      clientSecret: intent.client_secret,
      paymentId:    payment._id,
      breakdown:    fees.summary,
      message:      "Payment intent created",
    });
  } catch (err) {
    console.error("createPaymentIntent error:", err.message);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to create payment intent",
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/webhook
// Stripe posts signed events here.
// IMPORTANT: this route must use express.raw() — see paymentRoutes.js
// ─────────────────────────────────────────────────────────────────────────────
export const handleWebhook = async (req, res) => {
  // req.stripeEvent is attached by verifyStripeWebhook middleware
  const event = req.stripeEvent;

  try {
    switch (event.type) {

      // ── Payment succeeded ──────────────────────────────────────────────────
      case "payment_intent.succeeded": {
        const intent = event.data.object;
        const payment = await Payment.findOneAndUpdate(
          { stripePaymentIntentId: intent.id },
          {
            $set: {
              paymentStatus:   "succeeded",
              stripeChargeId:  intent.latest_charge || null,
              receiptUrl:      intent.charges?.data?.[0]?.receipt_url || null,
              paidAt:          new Date(),
            },
          },
          { new: true }
        );

        if (payment) {
          console.log(`✅ Payment succeeded: ${payment._id} | ${payment.amountFormatted}`);

          // Notify client
          await _notifySilent({
            userId: payment.clientId,
            title:  "Payment Successful",
            body:   `Your payment of ${payment.amountFormatted} was processed successfully.`,
            type:   "payment_received",
            meta:   { paymentId: payment._id },
          });

          // Notify lawyer
          await _notifySilent({
            userId: payment.lawyerId,
            title:  "Payment Received",
            body:   `You received a payment of ${payment.lawyerAmountFormatted}.`,
            type:   "payment_received",
            meta:   { paymentId: payment._id },
          });
        }
        break;
      }

      // ── Payment failed ─────────────────────────────────────────────────────
      case "payment_intent.payment_failed": {
        const intent = event.data.object;
        const lastError = intent.last_payment_error;

        const payment = await Payment.findOneAndUpdate(
          { stripePaymentIntentId: intent.id },
          {
            $set: {
              paymentStatus:  "failed",
              failureCode:    lastError?.code    || "unknown",
              failureMessage: lastError?.message || "Payment failed",
              failedAt:       new Date(),
            },
          },
          { new: true }
        );

        if (payment) {
          console.log(`❌ Payment failed: ${payment._id}`);

          await _notifySilent({
            userId: payment.clientId,
            title:  "Payment Failed",
            body:   `Your payment failed: ${lastError?.message || "please try again."}`,
            type:   "system",
            meta:   { paymentId: payment._id },
          });
        }
        break;
      }

      // ── Refund created ─────────────────────────────────────────────────────
      case "charge.refunded": {
        const charge = event.data.object;

        // Find payment by charge ID
        const payment = await Payment.findOneAndUpdate(
          { stripeChargeId: charge.id },
          {
            $set: {
              paymentStatus: "refunded",
              refundId:      charge.refunds?.data?.[0]?.id || null,
              refundAmount:  charge.amount_refunded,
              refundedAt:    new Date(),
            },
          },
          { new: true }
        );

        if (payment) {
          console.log(`↩️  Refund processed: ${payment._id}`);
          await _notifySilent({
            userId: payment.clientId,
            title:  "Refund Processed",
            body:   `A refund of $${(charge.amount_refunded / 100).toFixed(2)} has been issued.`,
            type:   "payment_received",
            meta:   { paymentId: payment._id },
          });
        }
        break;
      }

      // ── Payout completed to lawyer's bank ─────────────────────────────────
      case "payout.paid": {
        const payout = event.data.object;
        console.log(`💸 Payout sent: ${payout.id} | $${(payout.amount / 100).toFixed(2)}`);
        break;
      }

      // ── Account updated (onboarding completed) ────────────────────────────
      case "account.updated": {
        const account = event.data.object;
        if (account.charges_enabled && account.payouts_enabled) {
          await User.findOneAndUpdate(
            { "lawyerProfile.stripeAccountId": account.id },
            { $set: { "lawyerProfile.stripeOnboarded": true } }
          );
          console.log(`🎉 Lawyer onboarded: ${account.id}`);
        }
        break;
      }

      default:
        // Ignore unhandled event types
        break;
    }

    // Always return 200 to acknowledge receipt
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("Webhook handler error:", err.message);
    // Still return 200 — returning 4xx causes Stripe to retry
    return res.status(200).json({ received: true, error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/payments/history
// Returns payment history for the authenticated user (role-aware).
// ─────────────────────────────────────────────────────────────────────────────
export const getPaymentHistory = async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const userId = req.user._id;
    const role   = req.user.role;

    // Build query based on role
    const query = {};
    if (role === "client") query.clientId = userId;
    else if (role === "lawyer") query.lawyerId = userId;
    // admin sees all — no filter

    if (status) query.paymentStatus = status;

    const [payments, total] = await Promise.all([
      Payment.find(query)
        .populate("clientId", "name email profileImage")
        .populate("lawyerId", "name email profileImage")
        .populate("caseId",   "title category status")
        .sort({ createdAt: -1 })
        .skip((page - 1) * Number(limit))
        .limit(Number(limit))
        .lean(),
      Payment.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      payments,
      pagination: {
        total,
        page:  Number(page),
        pages: Math.ceil(total / Number(limit)),
        limit: Number(limit),
      },
    });
  } catch (err) {
    console.error("getPaymentHistory error:", err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/payments/:id
// Get a single payment record (must belong to the requesting user, or admin).
// ─────────────────────────────────────────────────────────────────────────────
export const getPaymentById = async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id)
      .populate("clientId", "name email profileImage")
      .populate("lawyerId", "name email profileImage lawyerProfile.specializations")
      .populate("caseId",   "title category status");

    if (!payment) {
      return res.status(404).json({ success: false, message: "Payment not found" });
    }

    // Access control: user must be a party to this payment or an admin
    const userId = String(req.user._id);
    const isParty = String(payment.clientId._id) === userId ||
                    String(payment.lawyerId._id) === userId;

    if (!isParty && req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    return res.status(200).json({ success: true, payment });
  } catch (err) {
    console.error("getPaymentById error:", err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/:id/refund   [Admin only]
// Issue a full or partial refund on a succeeded payment.
// ─────────────────────────────────────────────────────────────────────────────
export const refundPayment = async (req, res) => {
  try {
    const { amountDollars, reason = "requested_by_customer" } = req.body;

    const payment = await Payment.findById(req.params.id);

    if (!payment) {
      return res.status(404).json({ success: false, message: "Payment not found" });
    }

    if (payment.paymentStatus !== "succeeded") {
      return res.status(400).json({
        success: false,
        message: `Cannot refund a payment with status: ${payment.paymentStatus}`,
      });
    }

    if (!payment.stripeChargeId) {
      return res.status(400).json({
        success: false,
        message: "No charge ID found for this payment. Contact Stripe support.",
      });
    }

    // Calculate refund amount
    let refundCents;
    if (amountDollars) {
      refundCents = Math.round(parseFloat(amountDollars) * 100);
      if (refundCents > payment.amount) {
        return res.status(400).json({
          success: false,
          message: "Refund amount exceeds original payment",
        });
      }
    }

    // Issue refund via Stripe
    const refund = await createRefund({
      chargeId:    payment.stripeChargeId,
      amountCents: refundCents,
      reason,
    });

    // Update payment record
    await Payment.findByIdAndUpdate(payment._id, {
      $set: {
        paymentStatus: refundCents && refundCents < payment.amount ? "succeeded" : "refunded",
        refundId:      refund.id,
        refundAmount:  refund.amount,
        refundReason:  reason,
        refundedAt:    new Date(),
      },
    });

    // Notify client
    await _notifySilent({
      userId: payment.clientId,
      title:  "Refund Initiated",
      body:   `A refund of $${(refund.amount / 100).toFixed(2)} has been initiated.`,
      type:   "payment_received",
      meta:   { paymentId: payment._id },
    });

    return res.status(200).json({
      success: true,
      message: "Refund processed successfully",
      refund: {
        id:     refund.id,
        amount: `$${(refund.amount / 100).toFixed(2)}`,
        status: refund.status,
      },
    });
  } catch (err) {
    console.error("refundPayment error:", err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/payments/admin/revenue   [Admin only]
// Platform revenue summary — total fees collected, breakdown by period.
// ─────────────────────────────────────────────────────────────────────────────
export const getAdminRevenue = async (req, res) => {
  try {
    const { period = "month" } = req.query;

    const now   = new Date();
    let   start;

    if (period === "week") {
      start = new Date(now);
      start.setDate(now.getDate() - 7);
    } else if (period === "month") {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (period === "year") {
      start = new Date(now.getFullYear(), 0, 1);
    } else {
      start = new Date(0); // all time
    }

    const [totals, periodTotals, recentPayments, statusBreakdown] = await Promise.all([
      // All-time totals
      Payment.aggregate([
        { $match: { paymentStatus: "succeeded" } },
        {
          $group: {
            _id:              null,
            totalRevenue:     { $sum: "$amount" },
            totalPlatformFee: { $sum: "$platformFee" },
            totalLawyerPaid:  { $sum: "$lawyerAmount" },
            count:            { $sum: 1 },
          },
        },
      ]),

      // Period totals
      Payment.aggregate([
        { $match: { paymentStatus: "succeeded", createdAt: { $gte: start } } },
        {
          $group: {
            _id:              null,
            totalRevenue:     { $sum: "$amount" },
            totalPlatformFee: { $sum: "$platformFee" },
            totalLawyerPaid:  { $sum: "$lawyerAmount" },
            count:            { $sum: 1 },
          },
        },
      ]),

      // Recent 10 payments
      Payment.find({ paymentStatus: "succeeded" })
        .populate("clientId", "name email")
        .populate("lawyerId", "name email")
        .sort({ paidAt: -1 })
        .limit(10)
        .lean(),

      // Status breakdown
      Payment.aggregate([
        { $group: { _id: "$paymentStatus", count: { $sum: 1 }, total: { $sum: "$amount" } } },
      ]),
    ]);

    const allTime = totals[0] || { totalRevenue: 0, totalPlatformFee: 0, totalLawyerPaid: 0, count: 0 };
    const thisPeriod = periodTotals[0] || { totalRevenue: 0, totalPlatformFee: 0, totalLawyerPaid: 0, count: 0 };

    return res.status(200).json({
      success: true,
      revenue: {
        allTime: {
          totalRevenue:     `$${(allTime.totalRevenue     / 100).toFixed(2)}`,
          platformEarnings: `$${(allTime.totalPlatformFee / 100).toFixed(2)}`,
          lawyersPaid:      `$${(allTime.totalLawyerPaid  / 100).toFixed(2)}`,
          transactions:     allTime.count,
        },
        [period]: {
          totalRevenue:     `$${(thisPeriod.totalRevenue     / 100).toFixed(2)}`,
          platformEarnings: `$${(thisPeriod.totalPlatformFee / 100).toFixed(2)}`,
          lawyersPaid:      `$${(thisPeriod.totalLawyerPaid  / 100).toFixed(2)}`,
          transactions:     thisPeriod.count,
        },
        statusBreakdown,
        recentPayments,
      },
    });
  } catch (err) {
    console.error("getAdminRevenue error:", err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/payments/lawyer/earnings   [Lawyer only]
// Lawyer's personal earnings summary.
// ─────────────────────────────────────────────────────────────────────────────
export const getLawyerEarnings = async (req, res) => {
  try {
    const lawyerId = req.user._id;

    const [totals, recentPayments] = await Promise.all([
      Payment.aggregate([
        { $match: { lawyerId, paymentStatus: "succeeded" } },
        {
          $group: {
            _id:             null,
            totalEarned:     { $sum: "$lawyerAmount" },
            totalTransacted: { $sum: "$amount" },
            count:           { $sum: 1 },
          },
        },
      ]),
      Payment.find({ lawyerId, paymentStatus: "succeeded" })
        .populate("clientId", "name email profileImage")
        .populate("caseId",   "title category")
        .sort({ paidAt: -1 })
        .limit(10)
        .lean(),
    ]);

    const stats = totals[0] || { totalEarned: 0, totalTransacted: 0, count: 0 };

    return res.status(200).json({
      success: true,
      earnings: {
        totalEarned:     `$${(stats.totalEarned     / 100).toFixed(2)}`,
        totalTransacted: `$${(stats.totalTransacted / 100).toFixed(2)}`,
        transactions:    stats.count,
        recentPayments,
      },
    });
  } catch (err) {
    console.error("getLawyerEarnings error:", err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Internal helper — fire-and-forget notification (never throws)
// ─────────────────────────────────────────────────────────────────────────────
const _notifySilent = async ({ userId, title, body, type, meta }) => {
  try {
    await createNotification({ userId, title, body, type, meta });
  } catch (err) {
    console.error("Payment notification failed (non-fatal):", err.message);
  }
};