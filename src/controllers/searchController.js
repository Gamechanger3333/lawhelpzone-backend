// backend/src/controllers/searchController.js
import User from "../models/User.js";
import Case from "../models/Case.js";

// GET /api/search/lawyers
export const searchLawyers = async (req, res) => {
  try {
    const { query, specialty, location, minRating, maxRate, page = 1, limit = 20 } = req.query;

    const filter = { role: "lawyer", active: true };

    if (query) {
      filter.$or = [
        { name:                            { $regex: query, $options: "i" } },
        { "lawyerProfile.specializations": { $regex: query, $options: "i" } },
        { "lawyerProfile.bio":             { $regex: query, $options: "i" } },
      ];
    }

    if (specialty) {
      filter["lawyerProfile.specializations"] = { $regex: specialty, $options: "i" };
    }

    // location matches against the GeoJSON nested fields stored in User
    if (location) {
      const locationOr = [
        { "location.city":    { $regex: location, $options: "i" } },
        { "location.state":   { $regex: location, $options: "i" } },
        { "location.country": { $regex: location, $options: "i" } },
      ];
      filter.$or = filter.$or ? [...filter.$or, ...locationOr] : locationOr;
    }

    if (minRating) filter["lawyerProfile.rating"]    = { $gte: parseFloat(minRating) };
    if (maxRate)   filter["lawyerProfile.hourlyRate"] = { $lte: parseFloat(maxRate) };

    const skip = (page - 1) * limit;

    const [lawyers, total] = await Promise.all([
      User.find(filter)
        .select("-password -refreshToken -passwordResetToken -emailVerificationToken -loginHistory")
        .skip(skip)
        .limit(Number(limit))
        .sort({ "lawyerProfile.rating": -1 }),
      User.countDocuments(filter),
    ]);

    res.json({
      success: true,
      lawyers,
      pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/search/cases  — search open cases (lawyers browsing for work)
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
    if (urgency)  filter.urgency = urgency;

    if (minBudget || maxBudget) {
      filter.budget = {};
      if (minBudget) filter.budget.$gte = parseFloat(minBudget);
      if (maxBudget) filter.budget.$lte = parseFloat(maxBudget);
    }

    const skip = (page - 1) * limit;

    const [cases, total] = await Promise.all([
      Case.find(filter)
        .populate("clientId", "name profileImage")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Case.countDocuments(filter),
    ]);

    res.json({
      success: true,
      cases,
      pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};