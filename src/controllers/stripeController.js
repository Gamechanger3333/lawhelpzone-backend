// backend/src/controllers/stripeController.js
//
// Handles all Stripe Connect flows for lawyer onboarding.
// Lawyers must complete onboarding before they can receive payments.

import User from "../models/User.js";
import {
  createConnectAccount,
  createAccountLink,
  retrieveAccount,
  createLoginLink,
} from "../services/stripeService.js";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/stripe/connect-account
// Lawyer initiates Stripe Connect onboarding.
// Creates a Stripe Express account and returns the onboarding URL.
// ─────────────────────────────────────────────────────────────────────────────
export const connectAccount = async (req, res) => {
  try {
    const lawyer = await User.findById(req.user._id);

    if (!lawyer || lawyer.role !== "lawyer") {
      return res.status(403).json({
        success: false,
        message: "Only lawyers can connect a Stripe account",
      });
    }

    // If already fully onboarded, just return the dashboard link
    if (
      lawyer.lawyerProfile?.stripeConnected &&
      lawyer.lawyerProfile?.stripeOnboarded
    ) {
      return res.status(200).json({
        success: true,
        message: "Stripe account already connected",
        stripeAccountId: lawyer.lawyerProfile.stripeAccountId,
        onboarded: true,
      });
    }

    let stripeAccountId = lawyer.lawyerProfile?.stripeAccountId;

    // Create new Stripe account if lawyer doesn't have one yet
    if (!stripeAccountId) {
      const account = await createConnectAccount({
        email:    lawyer.email,
        name:     lawyer.name,
        lawyerId: lawyer._id,
      });

      stripeAccountId = account.id;

      // Persist the account ID immediately
      lawyer.lawyerProfile.stripeAccountId = stripeAccountId;
      lawyer.lawyerProfile.stripeConnected  = true;
      lawyer.markModified("lawyerProfile");
      await lawyer.save({ validateBeforeSave: false });
    }

    // Generate (or re-generate) onboarding link
    const accountLink = await createAccountLink({
      accountId: stripeAccountId,
      lawyerId:  lawyer._id,
    });

    return res.status(200).json({
      success:        true,
      message:        "Stripe onboarding link created",
      onboardingUrl:  accountLink.url,
      stripeAccountId,
      expiresAt:      new Date(accountLink.expires_at * 1000).toISOString(),
    });
  } catch (err) {
    console.error("connectAccount error:", err.message);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to create Stripe Connect account",
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/stripe/account-status
// Check whether the lawyer's Stripe account is fully onboarded.
// Called by frontend after lawyer returns from Stripe's onboarding flow.
// ─────────────────────────────────────────────────────────────────────────────
export const getAccountStatus = async (req, res) => {
  try {
    const lawyer = await User.findById(req.user._id);
    const accountId = lawyer?.lawyerProfile?.stripeAccountId;

    if (!accountId) {
      return res.status(200).json({
        success:   true,
        connected: false,
        onboarded: false,
        message:   "No Stripe account found. Please complete onboarding.",
      });
    }

    // Fetch live status from Stripe
    const account = await retrieveAccount(accountId);

    const isOnboarded = account.charges_enabled && account.payouts_enabled;

    // Sync status back to DB if it changed
    if (isOnboarded !== lawyer.lawyerProfile.stripeOnboarded) {
      lawyer.lawyerProfile.stripeOnboarded = isOnboarded;
      lawyer.markModified("lawyerProfile");
      await lawyer.save({ validateBeforeSave: false });
    }

    return res.status(200).json({
      success:         true,
      connected:       true,
      onboarded:       isOnboarded,
      chargesEnabled:  account.charges_enabled,
      payoutsEnabled:  account.payouts_enabled,
      stripeAccountId: accountId,
      requirements:    account.requirements,
    });
  } catch (err) {
    console.error("getAccountStatus error:", err.message);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to fetch Stripe account status",
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/stripe/dashboard-link
// Returns a one-time login link for the lawyer's Stripe Express dashboard.
// Lawyers use this to view their earnings, payouts, and tax documents.
// ─────────────────────────────────────────────────────────────────────────────
export const getDashboardLink = async (req, res) => {
  try {
    const lawyer = await User.findById(req.user._id);
    const accountId = lawyer?.lawyerProfile?.stripeAccountId;

    if (!accountId || !lawyer.lawyerProfile?.stripeOnboarded) {
      return res.status(400).json({
        success: false,
        message: "Please complete Stripe onboarding before accessing the dashboard",
      });
    }

    const loginLink = await createLoginLink(accountId);

    return res.status(200).json({
      success:  true,
      loginUrl: loginLink.url,
    });
  } catch (err) {
    console.error("getDashboardLink error:", err.message);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to create dashboard link",
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/stripe/refresh
// Lawyer lands here if their onboarding link expired — generate a new one.
// ─────────────────────────────────────────────────────────────────────────────
export const refreshOnboardingLink = async (req, res) => {
  try {
    const lawyer = await User.findById(req.user._id);
    const accountId = lawyer?.lawyerProfile?.stripeAccountId;

    if (!accountId) {
      return res.status(400).json({
        success: false,
        message: "No Stripe account found. Start onboarding first.",
      });
    }

    const accountLink = await createAccountLink({
      accountId,
      lawyerId: lawyer._id,
    });

    return res.status(200).json({
      success:       true,
      onboardingUrl: accountLink.url,
    });
  } catch (err) {
    console.error("refreshOnboardingLink error:", err.message);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to refresh onboarding link",
    });
  }
};