// backend/src/models/Payment.js
import mongoose from "mongoose";

const paymentSchema = new mongoose.Schema(
  {
    // ── Parties ───────────────────────────────────────────────────────────────
    clientId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "User",
      required: [true, "Client is required"],
      index:    true,
    },
    lawyerId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "User",
      required: [true, "Lawyer is required"],
      index:    true,
    },
    caseId: {
      type:  mongoose.Schema.Types.ObjectId,
      ref:   "Case",
      index: true,
    },

    // ── Amounts (all stored in USD cents for Stripe precision) ────────────────
    amount:        { type: Number, required: true, min: [50, "Minimum payment is $0.50"] }, // cents
    platformFee:   { type: Number, required: true, min: 0 },   // cents — 20% to platform
    lawyerAmount:  { type: Number, required: true, min: 0 },   // cents — 80% to lawyer
    currency:      { type: String, default: "usd", lowercase: true },

    // ── Stripe identifiers ────────────────────────────────────────────────────
    stripePaymentIntentId: { type: String, unique: true, sparse: true },
    stripeChargeId:        { type: String, default: null },
    stripeTransferId:      { type: String, default: null },

    // ── Status lifecycle: pending → succeeded | failed | refunded | disputed ──
    paymentStatus: {
      type:    String,
      enum:    ["pending", "succeeded", "failed", "refunded", "disputed", "cancelled"],
      default: "pending",
      index:   true,
    },

    // ── Payment type ──────────────────────────────────────────────────────────
    paymentType: {
      type:    String,
      enum:    ["case_payment", "consultation_fee", "retainer", "subscription"],
      default: "case_payment",
    },

    // ── Refund tracking ───────────────────────────────────────────────────────
    refundId:     { type: String, default: null },
    refundAmount: { type: Number, default: 0 },
    refundReason: { type: String, default: "" },
    refundedAt:   { type: Date,   default: null },

    // ── Metadata + audit ──────────────────────────────────────────────────────
    description: { type: String, default: "" },
    metadata:    { type: mongoose.Schema.Types.Mixed, default: {} },
    failureCode:    { type: String, default: null },
    failureMessage: { type: String, default: null },
    receiptUrl:     { type: String, default: null },

    // ── Timestamps for key events ─────────────────────────────────────────────
    paidAt:   { type: Date, default: null },
    failedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON:   { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ── Virtuals ──────────────────────────────────────────────────────────────────
paymentSchema.virtual("amountFormatted").get(function () {
  return `$${(this.amount / 100).toFixed(2)}`;
});
paymentSchema.virtual("lawyerAmountFormatted").get(function () {
  return `$${(this.lawyerAmount / 100).toFixed(2)}`;
});
paymentSchema.virtual("platformFeeFormatted").get(function () {
  return `$${(this.platformFee / 100).toFixed(2)}`;
});

// ── Indexes for common query patterns ────────────────────────────────────────
paymentSchema.index({ clientId: 1, createdAt: -1 });
paymentSchema.index({ lawyerId: 1, createdAt: -1 });
paymentSchema.index({ paymentStatus: 1, createdAt: -1 });
paymentSchema.index({ stripePaymentIntentId: 1 });

const Payment =
  mongoose.models.Payment || mongoose.model("Payment", paymentSchema);

export default Payment;