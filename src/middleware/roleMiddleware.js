// backend/src/middleware/roleMiddleware.js
//
// Thin wrappers around authMiddleware.restrictTo for payment-specific roles.
// These exist so payment routes read clearly without raw restrictTo() calls.

import { restrictTo } from "./authMiddleware.js";

/** Only authenticated clients can initiate payments */
export const clientOnly = restrictTo("client");

/** Only authenticated lawyers can connect Stripe / view payouts */
export const lawyerOnly = restrictTo("lawyer");

/** Only admins can view all payment data and issue refunds */
export const adminOnly = restrictTo("admin");

/** Clients OR admins */
export const clientOrAdmin = restrictTo("client", "admin");

/** Lawyers OR admins */
export const lawyerOrAdmin = restrictTo("lawyer", "admin");