// backend/src/controllers/lawyerController.js
// Lawyers are stored in the User model with role:"lawyer" and lawyerProfile sub-doc.
// The separate Lawyer.js model is only for legacy/Lawyer-directory data.
import User from "../models/User.js";

// GET /api/lawyers  — public, paginated, filterable
export const getLawyers = async (req, res) => {
  try {
    const { keyword, specialty, location, minRating, maxRate, page = 1, limit = 10 } = req.query;

    const filter = { role: "lawyer", active: true };

    if (keyword) {
      filter.$or = [
        { name:                               { $regex: keyword, $options: "i" } },
        { "lawyerProfile.specializations":    { $regex: keyword, $options: "i" } },
        { "lawyerProfile.bio":                { $regex: keyword, $options: "i" } },
      ];
    }

    if (specialty) {
      filter["lawyerProfile.specializations"] = { $regex: specialty, $options: "i" };
    }

    if (location) {
      filter.$or = [
        ...(filter.$or || []),
        { "location.city":    { $regex: location, $options: "i" } },
        { "location.country": { $regex: location, $options: "i" } },
      ];
    }

    if (minRating) filter["lawyerProfile.rating"]    = { $gte: parseFloat(minRating) };
    if (maxRate)   filter["lawyerProfile.hourlyRate"] = { $lte: parseFloat(maxRate) };

    const skip = (page - 1) * limit;

    const [lawyers, total] = await Promise.all([
      User.find(filter)
        .select("-password -refreshToken -passwordResetToken -emailVerificationToken")
        .sort({ "lawyerProfile.rating": -1, createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
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

// GET /api/lawyers/featured  — top-rated verified lawyers
export const getFeaturedLawyers = async (req, res) => {
  try {
    const lawyers = await User.find({
      role:    "lawyer",
      active:  true,
      verified: true,
      "lawyerProfile.rating": { $gte: 4.0 },
    })
      .select("name profileImage lawyerProfile isOnline lastSeen")
      .sort({ "lawyerProfile.rating": -1, "lawyerProfile.totalReviews": -1 })
      .limit(6);

    res.json({ success: true, lawyers });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/lawyers/:id
export const getLawyerById = async (req, res) => {
  try {
    const lawyer = await User.findOne({ _id: req.params.id, role: "lawyer" }).select(
      "-password -refreshToken -passwordResetToken -emailVerificationToken"
    );

    if (!lawyer) {
      return res.status(404).json({ success: false, message: "Lawyer not found" });
    }

    res.json({ success: true, lawyer });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/lawyers/profile  — lawyer updates their own profile
export const updateLawyerProfile = async (req, res) => {
  try {
    const { specializations, hourlyRate, bio } = req.body;

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      {
        $set: {
          ...(specializations && { "lawyerProfile.specializations": specializations }),
          ...(hourlyRate !== undefined && { "lawyerProfile.hourlyRate": hourlyRate }),
          ...(bio && { "lawyerProfile.bio": bio }),
        },
      },
      { new: true, runValidators: true }
    ).select("-password -refreshToken");

    res.json({ success: true, lawyer: updatedUser });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/cases/:id/proposals  — lawyer submits proposal (used from caseRoutes)
export const submitProposal = async (req, res) => {
  try {
    const { message, proposedBudget, proposedDeadline } = req.body;
    const caseItem = await (await import("../models/Case.js")).default.findById(req.params.id);

    if (!caseItem) {
      return res.status(404).json({ success: false, message: "Case not found" });
    }

    if (caseItem.status !== "open") {
      return res.status(400).json({ success: false, message: "This case is no longer accepting proposals" });
    }

    // Prevent duplicate proposals
    const alreadyProposed = caseItem.proposals.some(
      (p) => p.lawyerId.toString() === req.user._id.toString()
    );
    if (alreadyProposed) {
      return res.status(400).json({ success: false, message: "You already submitted a proposal for this case" });
    }

    caseItem.proposals.push({
      lawyerId:         req.user._id,
      message,
      proposedBudget:   proposedBudget  || caseItem.budget,
      proposedDeadline: proposedDeadline || caseItem.deadline,
    });
    await caseItem.save();

    // Notify the client
    const { createNotification } = await import("./notificationController.js");
    await createNotification({
      userId: caseItem.clientId,
      type:   "new_proposal",
      title:  "New Proposal Received",
      message: `${req.user.name} submitted a proposal for "${caseItem.title}"`,
      data:    { caseId: caseItem._id, lawyerId: req.user._id },
      link:    `/dashboard/cases/${caseItem._id}`,
    });

    res.json({ success: true, message: "Proposal submitted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/cases/:id/accept  — client accepts a proposal → assigns lawyer
export const acceptProposal = async (req, res) => {
  try {
    const { lawyerId } = req.body;
    const caseItem = await (await import("../models/Case.js")).default.findById(req.params.id);

    if (!caseItem) {
      return res.status(404).json({ success: false, message: "Case not found" });
    }

    if (caseItem.clientId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }

    caseItem.assignedLawyerId = lawyerId;
    caseItem.status           = "in-progress";
    await caseItem.save();

    // Notify the lawyer
    const { createNotification } = await import("./notificationController.js");
    await createNotification({
      userId:  lawyerId,
      type:    "proposal_accepted",
      title:   "Proposal Accepted",
      message: `Your proposal for "${caseItem.title}" was accepted!`,
      data:    { caseId: caseItem._id },
      link:    `/dashboard/cases/${caseItem._id}`,
    });

    res.json({ success: true, case: caseItem });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};