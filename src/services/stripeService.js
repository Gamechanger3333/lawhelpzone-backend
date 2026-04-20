// backend/src/services/stripeService.js
//
// Single source of truth for ALL Stripe API interactions.
// Controllers call these functions — they never call stripe.* directly.

import Stripe from "stripe";

// Lazy singleton — initialised on first use so dotenv.config() has already run
let _stripe = null;
const stripe = () => {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY is not set in environment variables");
    }
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2024-04-10",
      appInfo: { name: "LawHelpZone", version: "1.0.0" },
    });
  }
  return _stripe;
};

// ─────────────────────────────────────────────────────────────────────────────
// STRIPE CONNECT — Lawyer Onboarding
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a Stripe Connect Express account for a lawyer.
 * Returns the account object (contains .id = "acct_xxx").
 */
export const createConnectAccount = async ({ email, name, lawyerId }) => {
  return stripe().accounts.create({
    type:  "express",
    email,
    business_profile: {
      name: name,
    },
    capabilities: {
      card_payments: { requested: true },
      transfers:     { requested: true },
    },
    business_type: "individual",
    metadata: { lawyerId: lawyerId.toString() },
  });
};

/**
 * Generate a Stripe-hosted onboarding link.
 * Lawyer is redirected here to complete identity verification.
 */
export const createAccountLink = async ({ accountId, lawyerId }) => {
  const baseUrl = process.env.CLIENT_URL || "http://localhost:3000";

  return stripe().accountLinks.create({
    account:     accountId,
    refresh_url: `${baseUrl}/dashboard/payments/stripe/refresh`,
    return_url:  `${baseUrl}/dashboard/payments/stripe/success?lawyerId=${lawyerId}`,
    type:        "account_onboarding",
  });
};

/**
 * Retrieve a Connect account to check onboarding status.
 */
export const retrieveAccount = async (accountId) => {
  return stripe().accounts.retrieve(accountId);
};

/**
 * Generate a Stripe Express Dashboard login link for a connected account.
 * Lawyers use this to view their payouts.
 */
export const createLoginLink = async (accountId) => {
  return stripe().accounts.createLoginLink(accountId);
};

// ─────────────────────────────────────────────────────────────────────────────
// PAYMENT INTENTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a Stripe PaymentIntent using destination charge.
 *
 * Stripe flow:
 *   Client → Platform (full amount)
 *   Platform deducts application_fee_amount (platform's cut)
 *   Remainder auto-transferred to lawyer's connected account
 *
 * @param {object} params
 * @param {number}  params.amountCents          Total charge in cents
 * @param {number}  params.platformFeeCents      Platform fee in cents (20%)
 * @param {string}  params.lawyerStripeAccountId Connected account ID (acct_xxx)
 * @param {string}  params.currency
 * @param {object}  params.metadata             Stored on the PaymentIntent
 * @param {string}  params.description          Shown on receipts
 */
export const createPaymentIntent = async ({
  amountCents,
  platformFeeCents,
  lawyerStripeAccountId,
  currency = "usd",
  metadata = {},
  description = "LawHelpZone legal service payment",
}) => {
  return stripe().paymentIntents.create({
    amount:   amountCents,
    currency,
    description,
    application_fee_amount: platformFeeCents,
    transfer_data: {
      destination: lawyerStripeAccountId,
    },
    metadata,
    automatic_payment_methods: { enabled: true },
  });
};

/**
 * Retrieve a PaymentIntent by ID.
 */
export const retrievePaymentIntent = async (paymentIntentId) => {
  return stripe().paymentIntents.retrieve(paymentIntentId);
};

/**
 * Cancel a PaymentIntent (before it's confirmed).
 */
export const cancelPaymentIntent = async (paymentIntentId) => {
  return stripe().paymentIntents.cancel(paymentIntentId);
};

// ─────────────────────────────────────────────────────────────────────────────
// REFUNDS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Issue a full or partial refund on a charge.
 *
 * @param {string} chargeId       Stripe charge ID (ch_xxx)
 * @param {number} [amountCents]  Partial refund amount. Omit for full refund.
 * @param {string} [reason]       "duplicate" | "fraudulent" | "requested_by_customer"
 */
export const createRefund = async ({ chargeId, amountCents, reason = "requested_by_customer" }) => {
  const params = { charge: chargeId, reason };
  if (amountCents) params.amount = amountCents;
  return stripe().refunds.create(params);
};

// ─────────────────────────────────────────────────────────────────────────────
// WEBHOOKS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verify and construct a Stripe webhook event from raw body + signature.
 * Throws if signature is invalid.
 *
 * @param {Buffer} rawBody     Raw request body (must NOT be JSON.parsed)
 * @param {string} signature   Value of stripe-signature header
 */
export const constructWebhookEvent = (rawBody, signature) => {
  return stripe().webhooks.constructEvent(
    rawBody,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMERS (optional — for saving cards)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create or retrieve a Stripe Customer for a platform user.
 * Useful for saving payment methods for repeat clients.
 */
export const createOrGetCustomer = async ({ email, name, userId }) => {
  const existing = await stripe().customers.list({ email, limit: 1 });
  if (existing.data.length > 0) return existing.data[0];

  return stripe().customers.create({
    email,
    name,
    metadata: { userId: userId.toString() },
  });
};