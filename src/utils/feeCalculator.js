// backend/src/utils/feeCalculator.js
//
// Central fee calculation — all payment math happens HERE, never in frontend.
// Stripe works in the smallest currency unit (cents for USD).
//
// Business rule:  Platform = 20%  |  Lawyer = 80%

const PLATFORM_FEE_PERCENT = Number(process.env.PLATFORM_FEE_PERCENTAGE) || 20;
const MIN_PAYMENT_CENTS    = 50;   // Stripe minimum: $0.50
const MAX_PAYMENT_CENTS    = 999_999_99; // Stripe max: $999,999.99

/**
 * Calculate fee split for a payment.
 *
 * @param {number} amountDollars  - Payment in dollars (e.g. 100 for $100)
 * @returns {{ amountCents, platformFeeCents, lawyerAmountCents, feePercent }}
 *
 * @throws {Error} if amount is invalid or out of range
 */
export const calculateFees = (amountDollars) => {
  const amount = parseFloat(amountDollars);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Payment amount must be a positive number");
  }

  // Convert to cents (round to avoid floating-point issues)
  const amountCents = Math.round(amount * 100);

  if (amountCents < MIN_PAYMENT_CENTS) {
    throw new Error(`Minimum payment is $${(MIN_PAYMENT_CENTS / 100).toFixed(2)}`);
  }

  if (amountCents > MAX_PAYMENT_CENTS) {
    throw new Error(`Maximum payment is $${(MAX_PAYMENT_CENTS / 100).toFixed(2)}`);
  }

  // Floor ensures we never over-charge the platform fee
  const platformFeeCents  = Math.floor(amountCents * (PLATFORM_FEE_PERCENT / 100));
  const lawyerAmountCents = amountCents - platformFeeCents;

  return {
    amountCents,
    platformFeeCents,
    lawyerAmountCents,
    feePercent: PLATFORM_FEE_PERCENT,
    // Human-readable summary for logging / receipts
    summary: {
      total:       `$${(amountCents       / 100).toFixed(2)}`,
      platformFee: `$${(platformFeeCents  / 100).toFixed(2)} (${PLATFORM_FEE_PERCENT}%)`,
      lawyerGets:  `$${(lawyerAmountCents / 100).toFixed(2)} (${100 - PLATFORM_FEE_PERCENT}%)`,
    },
  };
};

/**
 * Validate that a dollar string/number is safe to process.
 * Used in route validators before touching Stripe.
 */
export const isValidAmount = (amount) => {
  const n = parseFloat(amount);
  if (!Number.isFinite(n) || n <= 0) return false;
  const cents = Math.round(n * 100);
  return cents >= MIN_PAYMENT_CENTS && cents <= MAX_PAYMENT_CENTS;
};

/**
 * Convert dollar amount to cents safely.
 */
export const toCents = (dollars) => Math.round(parseFloat(dollars) * 100);

/**
 * Convert cents to dollar string.
 */
export const toDollars = (cents) => (cents / 100).toFixed(2);