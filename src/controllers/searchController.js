// backend/src/controllers/searchController.js
import User from "../models/User.js";
import Case from "../models/Case.js";
import { buildLawyerFilter } from "./lawyerController.js";

// GET /api/search/lawyers
export const searchLawyers = async (req, res) => {
  try {
    const { page = 1, limit = 20, ...rest } = req.query;
    const filter = buildLawyerFilter(rest);
    const skip   = (page - 1) * Number(limit);

    const [lawyers, total] = await Promise.all([
      User.find(filter)
        .select("-password -refreshToken -passwordResetToken -emailVerificationToken -loginHistory")
        .sort({ "lawyerProfile.rating": -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      User.countDocuments(filter),
    ]);

    res.json({
      success: true,
      lawyers,
      pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / Number(limit)) },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/search/cases  — open cases for lawyers browsing for work
export const searchCases = async (req, res) => {
  try {
    const { query, category, country, minBudget, maxBudget, urgency, page = 1, limit = 20 } = req.query;

    const filter = { status: "open" };

    if (query) {
      filter.$or = [
        { title:       { $regex: query, $options: "i" } },
        { description: { $regex: query, $options: "i" } },
      ];
    }

    if (category && category !== "All Categories") filter.category = category;
    if (country  && country  !== "All Countries")   filter.country  = country;
    if (urgency)                                     filter.urgency  = urgency;

    if (minBudget || maxBudget) {
      filter.budget = {};
      if (minBudget) filter.budget.$gte = parseFloat(minBudget);
      if (maxBudget) filter.budget.$lte = parseFloat(maxBudget);
    }

    const skip = (page - 1) * Number(limit);

    const [cases, total] = await Promise.all([
      Case.find(filter)
        .populate("clientId", "name profileImage")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Case.countDocuments(filter),
    ]);

    res.json({
      success: true,
      cases,
      pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / Number(limit)) },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};