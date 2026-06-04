// backend/src/controllers/lawyerController.js
import User from "../models/User.js";

// Shared filter builder — used by getLawyers and searchController
export const buildLawyerFilter = ({ keyword, query, specialty, location, minRating, maxRate } = {}) => {
  const filter = { role: "lawyer", active: true };
  const term   = keyword || query;

  if (term) {
    filter.$or = [
      { name:                            { $regex: term, $options: "i" } },
      { "lawyerProfile.specializations": { $regex: term, $options: "i" } },
      { "lawyerProfile.bio":             { $regex: term, $options: "i" } },
    ];
  }

  if (specialty) filter["lawyerProfile.specializations"] = { $regex: specialty, $options: "i" };

  if (location) {
    const locOr = [
      { "location.city":    { $regex: location, $options: "i" } },
      { "location.state":   { $regex: location, $options: "i" } },
      { "location.country": { $regex: location, $options: "i" } },
    ];
    // Merge with any existing $or without overwriting
    filter.$or = filter.$or ? [...filter.$or, ...locOr] : locOr;
  }

  if (minRating) filter["lawyerProfile.rating"]    = { $gte: parseFloat(minRating) };
  if (maxRate)   filter["lawyerProfile.hourlyRate"] = { $lte: parseFloat(maxRate) };

  return filter;
};

// GET /api/lawyers
export const getLawyers = async (req, res) => {
  try {
    const { page = 1, limit = 10, ...rest } = req.query;
    const filter = buildLawyerFilter(rest);

    const [lawyers, total] = await Promise.all([
      User.find(filter)
        .select("-password -refreshToken -passwordResetToken -emailVerificationToken")
        .sort({ "lawyerProfile.rating": -1, createdAt: -1 })
        .skip((page - 1) * Number(limit))
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

// GET /api/lawyers/featured
export const getFeaturedLawyers = async (req, res) => {
  try {
    const lawyers = await User.find({
      role: "lawyer", active: true, verified: true,
      "lawyerProfile.rating": { $gte: 4.0 },
    })
      .select("name profileImage lawyerProfile isOnline lastSeen")
      .sort({ "lawyerProfile.rating": -1, "lawyerProfile.totalReviews": -1 })
      .limit(6)
      .lean();

    res.json({ success: true, lawyers });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/lawyers/:id
export const getLawyerById = async (req, res) => {
  try {
    const lawyer = await User.findOne({ _id: req.params.id, role: "lawyer" })
      .select("-password -refreshToken -passwordResetToken -emailVerificationToken")
      .lean();

    if (!lawyer) return res.status(404).json({ success: false, message: "Lawyer not found" });

    res.json({ success: true, lawyer });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};