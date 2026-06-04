// backend/src/controllers/paymentController.js
import Payment from "../models/Payment.js";
import User   from "../models/User.js";
import Case   from "../models/Case.js";
import { calculateFees }      from "../utils/feeCalculator.js";
import { createPaymentIntent,
         createRefund }        from "../services/stripeService.js";
import { createNotification } from "../utils/notificationService.js";

// Fire-and-forget notification helper
const _notify = async ({ userId, title, body, type, meta }) => {
  try {
    await createNotification({ userId, title, body, type, meta });
  } catch (err) {
    console.error("Payment notification failed (non-fatal):", err.message);
  }
};

// POST /api/payments/create-payment-intent
export const createPaymentIntentHandler = async (req, res) => {
  try {
    const { caseId, lawyerId, amount, description } = req.body;
    const clientId = req.user._id;

    if (!lawyerId || !amount)
      return res.status(400).json({ success: false, message: "lawyerId and amount are required" });

    const lawyer = await User.findOne({ _id: lawyerId, role: "lawyer" });
    if (!lawyer)
      return res.status(404).json({ success: false, message: "Lawyer not found" });

    if (!lawyer.lawyerProfile?.stripeAccountId)
      return res.status(400).json({ success: false, message: "This lawyer has not connected their Stripe account yet." });

    if (!lawyer.lawyerProfile?.stripeOnboarded)
      return res.status(400).json({ success: false, message: "This lawyer's payment account is not fully set up yet." });

    let caseDoc = null;
    if (caseId) {
      caseDoc = await Case.findById(caseId);
      if (!caseDoc)
        return res.status(404).json({ success: false, message: "Case not found" });
      if (String(caseDoc.clientId) !== String(clientId))
        return res.status(403).json({ success: false, message: "You do not own this case" });
    }

    let fees;
    try {
      fees = calculateFees(amount);
    } catch (feeErr) {
      return res.status(400).json({ success: false, message: feeErr.message });
    }

    const { amountCents, platformFeeCents, lawyerAmountCents } = fees;

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

    const payment = await Payment.create({
      clientId,
      lawyerId,
      caseId:                caseId || undefined,
      amount:                amountCents,
      platformFee:           platformFeeCents,
      lawyerAmount:          lawyerAmountCents,
      currency:              "usd",
      stripePaymentIntentId: intent.id,
      paymentStatus:         "pending",
      description:           description || `Payment to ${lawyer.name}`,
      metadata: {
        caseTitle:  caseDoc?.title || "",
        lawyerName: lawyer.name,
        clientName: req.user.name,
      },
    });

    return res.status(201).json({
      success:      true,
      clientSecret: intent.client_secret,
      paymentId:    payment._id,
      breakdown:    fees.summary,
    });
  } catch (err) {
    console.error("createPaymentIntent error:", err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/payments/webhook
export const handleWebhook = async (req, res) => {
  const event = req.stripeEvent;

  try {
    switch (event.type) {

      case "payment_intent.succeeded": {
        const intent  = event.data.object;
        const payment = await Payment.findOneAndUpdate(
          { stripePaymentIntentId: intent.id },
          { $set: { paymentStatus: "succeeded", stripeChargeId: intent.latest_charge || null, paidAt: new Date() } },
          { new: true }
        );
        if (payment) {
          await _notify({ userId: payment.clientId, title: "Payment Successful", body: `Your payment of ${payment.amountFormatted} was processed.`,  type: "payment_received", meta: { paymentId: payment._id } });
          await _notify({ userId: payment.lawyerId, title: "Payment Received",   body: `You received ${payment.lawyerAmountFormatted}.`,               type: "payment_received", meta: { paymentId: payment._id } });
        }
        break;
      }

      case "payment_intent.payment_failed": {
        const intent    = event.data.object;
        const lastError = intent.last_payment_error;
        const payment   = await Payment.findOneAndUpdate(
          { stripePaymentIntentId: intent.id },
          { $set: { paymentStatus: "failed", failureCode: lastError?.code || "unknown", failureMessage: lastError?.message || "Payment failed", failedAt: new Date() } },
          { new: true }
        );
        if (payment)
          await _notify({ userId: payment.clientId, title: "Payment Failed", body: `Your payment failed: ${lastError?.message || "please try again."}`, type: "system", meta: { paymentId: payment._id } });
        break;
      }

      case "charge.refunded": {
        const charge  = event.data.object;
        const payment = await Payment.findOneAndUpdate(
          { stripeChargeId: charge.id },
          { $set: { paymentStatus: "refunded", refundId: charge.refunds?.data?.[0]?.id || null, refundAmount: charge.amount_refunded, refundedAt: new Date() } },
          { new: true }
        );
        if (payment)
          await _notify({ userId: payment.clientId, title: "Refund Processed", body: `A refund of $${(charge.amount_refunded / 100).toFixed(2)} has been issued.`, type: "payment_received", meta: { paymentId: payment._id } });
        break;
      }

      case "account.updated": {
        const account = event.data.object;
        if (account.charges_enabled && account.payouts_enabled)
          await User.findOneAndUpdate(
            { "lawyerProfile.stripeAccountId": account.id },
            { $set: { "lawyerProfile.stripeOnboarded": true } }
          );
        break;
      }

      default: break;
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("Webhook handler error:", err.message);
    return res.status(200).json({ received: true }); // always 200 to Stripe
  }
};

// GET /api/payments/history
export const getPaymentHistory = async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const { _id: userId, role } = req.user;

    const query = {};
    if (role === "client") query.clientId = userId;
    else if (role === "lawyer") query.lawyerId = userId;
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

    return res.json({
      success: true,
      payments,
      pagination: { total, page: Number(page), pages: Math.ceil(total / Number(limit)) },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/payments/:id
export const getPaymentById = async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id)
      .populate("clientId", "name email profileImage")
      .populate("lawyerId", "name email profileImage lawyerProfile.specializations")
      .populate("caseId",   "title category status");

    if (!payment)
      return res.status(404).json({ success: false, message: "Payment not found" });

    const userId  = String(req.user._id);
    const isParty = String(payment.clientId._id) === userId || String(payment.lawyerId._id) === userId;

    if (!isParty && req.user.role !== "admin")
      return res.status(403).json({ success: false, message: "Access denied" });

    return res.json({ success: true, payment });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/payments/:id/refund  [Admin only]
export const refundPayment = async (req, res) => {
  try {
    const { amountDollars, reason = "requested_by_customer" } = req.body;
    const payment = await Payment.findById(req.params.id);

    if (!payment)
      return res.status(404).json({ success: false, message: "Payment not found" });
    if (payment.paymentStatus !== "succeeded")
      return res.status(400).json({ success: false, message: `Cannot refund a payment with status: ${payment.paymentStatus}` });
    if (!payment.stripeChargeId)
      return res.status(400).json({ success: false, message: "No charge ID found for this payment." });

    let refundCents;
    if (amountDollars) {
      refundCents = Math.round(parseFloat(amountDollars) * 100);
      if (refundCents > payment.amount)
        return res.status(400).json({ success: false, message: "Refund amount exceeds original payment" });
    }

    const refund = await createRefund({ chargeId: payment.stripeChargeId, amountCents: refundCents, reason });

    await Payment.findByIdAndUpdate(payment._id, {
      $set: {
        paymentStatus: refundCents && refundCents < payment.amount ? "succeeded" : "refunded",
        refundId:     refund.id,
        refundAmount: refund.amount,
        refundReason: reason,
        refundedAt:   new Date(),
      },
    });

    await _notify({
      userId: payment.clientId,
      title:  "Refund Initiated",
      body:   `A refund of $${(refund.amount / 100).toFixed(2)} has been initiated.`,
      type:   "payment_received",
      meta:   { paymentId: payment._id },
    });

    return res.json({
      success: true,
      message: "Refund processed successfully",
      refund:  { id: refund.id, amount: `$${(refund.amount / 100).toFixed(2)}`, status: refund.status },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/payments/admin/revenue  [Admin only]
export const getAdminRevenue = async (req, res) => {
  try {
    const { period = "month" } = req.query;

    // Create a fresh Date for each branch to avoid mutation
    const start =
      period === "week"  ? new Date(new Date().setDate(new Date().getDate() - 7)) :
      period === "month" ? new Date(new Date().getFullYear(), new Date().getMonth(), 1) :
      period === "year"  ? new Date(new Date().getFullYear(), 0, 1) :
      new Date(0);

    const groupStage = {
      _id:              null,
      totalRevenue:     { $sum: "$amount" },
      totalPlatformFee: { $sum: "$platformFee" },
      totalLawyerPaid:  { $sum: "$lawyerAmount" },
      count:            { $sum: 1 },
    };

    const [totals, periodTotals, recentPayments, statusBreakdown] = await Promise.all([
      Payment.aggregate([{ $match: { paymentStatus: "succeeded" } }, { $group: groupStage }]),
      Payment.aggregate([{ $match: { paymentStatus: "succeeded", createdAt: { $gte: start } } }, { $group: groupStage }]),
      Payment.find({ paymentStatus: "succeeded" })
        .populate("clientId", "name email")
        .populate("lawyerId", "name email")
        .sort({ paidAt: -1 })
        .limit(10)
        .lean(),
      Payment.aggregate([{ $group: { _id: "$paymentStatus", count: { $sum: 1 }, total: { $sum: "$amount" } } }]),
    ]);

    const fmt        = (cents) => `$${(cents / 100).toFixed(2)}`;
    const allTime    = totals[0]       || { totalRevenue: 0, totalPlatformFee: 0, totalLawyerPaid: 0, count: 0 };
    const thisPeriod = periodTotals[0] || { totalRevenue: 0, totalPlatformFee: 0, totalLawyerPaid: 0, count: 0 };

    return res.json({
      success: true,
      revenue: {
        allTime:  { totalRevenue: fmt(allTime.totalRevenue),    platformEarnings: fmt(allTime.totalPlatformFee),    lawyersPaid: fmt(allTime.totalLawyerPaid),    transactions: allTime.count },
        [period]: { totalRevenue: fmt(thisPeriod.totalRevenue), platformEarnings: fmt(thisPeriod.totalPlatformFee), lawyersPaid: fmt(thisPeriod.totalLawyerPaid), transactions: thisPeriod.count },
        statusBreakdown,
        recentPayments,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/payments/lawyer/earnings  [Lawyer only]
export const getLawyerEarnings = async (req, res) => {
  try {
    const lawyerId = req.user._id;

    const [totals, recentPayments] = await Promise.all([
      Payment.aggregate([
        { $match: { lawyerId, paymentStatus: "succeeded" } },
        { $group: { _id: null, totalEarned: { $sum: "$lawyerAmount" }, totalTransacted: { $sum: "$amount" }, count: { $sum: 1 } } },
      ]),
      Payment.find({ lawyerId, paymentStatus: "succeeded" })
        .populate("clientId", "name email profileImage")
        .populate("caseId",   "title category")
        .sort({ paidAt: -1 })
        .limit(10)
        .lean(),
    ]);

    const stats = totals[0] || { totalEarned: 0, totalTransacted: 0, count: 0 };
    const fmt   = (cents) => `$${(cents / 100).toFixed(2)}`;

    return res.json({
      success:  true,
      earnings: {
        totalEarned:      fmt(stats.totalEarned),
        totalTransacted:  fmt(stats.totalTransacted),
        transactions:     stats.count,
        recentPayments,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};