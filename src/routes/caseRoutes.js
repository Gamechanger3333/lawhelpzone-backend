// backend/src/routes/caseRoutes.js  — COMPLETE REPLACEMENT
import express from "express";
import Case    from "../models/Case.js";
import User    from "../models/User.js";
import { protect, restrictTo } from "../middleware/authMiddleware.js";
import { createNotification } from "../utils/notificationService.js";

const router = express.Router();
router.use(protect);

// ═══════════════════════════════════════════════════════════════════════════
// IMPORTANT: specific routes MUST come before /:id
// ═══════════════════════════════════════════════════════════════════════════

// ── GET /api/cases/stats ────────────────────────────────────────────────────
router.get("/stats", async (req, res) => {
  try {
    const uid  = req.user._id;
    const role = req.user.role;
    let stats  = {};

    if (role === "client") {
      const [active, total, resolved] = await Promise.all([
        Case.countDocuments({ clientId: uid, status: { $in: ["open","in-progress"] } }),
        Case.countDocuments({ clientId: uid }),
        Case.countDocuments({ clientId: uid, status: "closed" }),
      ]);
      stats = { activeCases: active, totalCases: total, resolvedCases: resolved };
    }
    if (role === "lawyer") {
      const [active, open, clients] = await Promise.all([
        Case.countDocuments({ assignedLawyerId: uid }),
        Case.countDocuments({ status: "open", assignedLawyerId: { $exists: false } }),
        Case.distinct("clientId", { assignedLawyerId: uid }),
      ]);
      stats = { activeCases: active, openOpportunities: open, clients: clients.length };
    }
    if (role === "admin") {
      const now   = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const [users, lawyers, monthCases, open] = await Promise.all([
        User.countDocuments(),
        User.countDocuments({ role: "lawyer" }),
        Case.countDocuments({ createdAt: { $gte: start } }),
        Case.countDocuments({ status: "open" }),
      ]);
      stats = { totalUsers: users, totalLawyers: lawyers, thisMonthCases: monthCases, openCases: open };
    }
    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/cases/available — open unassigned cases for lawyers ─────────────
router.get("/available", async (req, res) => {
  try {
    const { category, country, search, sortBy = "newest", page = 1, limit = 20 } = req.query;
    const filter = {
      status: "open",
      $or: [
        { assignedLawyerId: { $exists: false } },
        { assignedLawyerId: null },
      ],
    };
    if (category && category !== "All Categories") filter.category = category;
    if (country  && country  !== "All Countries")   filter.country  = country;
    if (search) filter.$and = [{ $or: [
      { title:       { $regex: search, $options: "i" } },
      { description: { $regex: search, $options: "i" } },
      { location:    { $regex: search, $options: "i" } },
    ]}];

    const sortMap = { newest:"createdAt:-1", oldest:"createdAt:1", budget_high:"budget:-1", budget_low:"budget:1" };
    const [field, dir] = (sortMap[sortBy]||"createdAt:-1").split(":");
    const sort = { [field]: parseInt(dir) };

    const [cases, total] = await Promise.all([
      Case.find(filter)
        .populate("clientId", "name profileImage email")
        .sort(sort)
        .skip((page - 1) * Number(limit))
        .limit(Number(limit))
        .lean(),
      Case.countDocuments(filter),
    ]);
    res.json({ success: true, cases, total, pages: Math.ceil(total / Number(limit)) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/cases/my-cases — assigned cases for lawyer OR client's own ──────
router.get("/my-cases", async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const filter = req.user.role === "lawyer"
      ? { assignedLawyerId: req.user._id }
      : { clientId: req.user._id };
    if (status) filter.status = status;

    const [cases, total] = await Promise.all([
      Case.find(filter)
        .populate("clientId",         "name profileImage email")
        .populate("assignedLawyerId", "name profileImage email lawyerProfile")
        .sort({ updatedAt: -1 })
        .skip((page - 1) * Number(limit))
        .limit(Number(limit))
        .lean(),
      Case.countDocuments(filter),
    ]);
    res.json({ success: true, cases, total });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/cases/lawyers — lawyers working on current client's cases ───────
router.get("/lawyers", async (req, res) => {
  try {
    if (req.user.role !== "client" && req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Clients only" });
    }
    const filter = { clientId: req.user._id, assignedLawyerId: { $exists: true, $ne: null } };
    const cases  = await Case.find(filter)
      .populate("assignedLawyerId", "name email profileImage lawyerProfile")
      .lean();

    const seen = new Set(); const lawyers = [];
    cases.forEach(c => {
      const l = c.assignedLawyerId;
      if (l && !seen.has(String(l._id))) { seen.add(String(l._id)); lawyers.push(l); }
    });
    res.json({ success: true, lawyers });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/cases (role-filtered list) ─────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const { status, category, country, search, sortBy = "newest", page = 1, limit = 20 } = req.query;
    const filter = {};

    if (req.user.role === "client") {
      filter.clientId = req.user._id;
    } else if (req.user.role === "lawyer") {
      if (req.query.mine === "true") filter.assignedLawyerId = req.user._id;
      else {
        // Use $and so a subsequent search $or doesn't overwrite this one
        filter.$and = [
          { status: "open" },
          { $or: [{ assignedLawyerId: { $exists: false } }, { assignedLawyerId: null }] },
        ];
      }
    }
    if (status)   filter.status   = status;
    if (category && category !== "All Categories") filter.category = category;
    if (country  && country  !== "All Countries")  filter.country  = country;
    if (search) {
      const s = { $regex: search, $options: "i" };
      const searchOr = [{ title: s }, { description: s }, { location: s }];
      // Safely merge: push into existing $and if present, otherwise set $or
      if (filter.$and) filter.$and.push({ $or: searchOr });
      else if (filter.$or) filter.$and = [{ $or: filter.$or }, { $or: searchOr }];
      else filter.$or = searchOr;
    }

    const sortMap = { newest: { createdAt: -1 }, oldest: { createdAt: 1 }, budget_high: { budget: -1 } };
    const [cases, total] = await Promise.all([
      Case.find(filter)
        .populate("clientId",         "name profileImage")
        .populate("assignedLawyerId", "name profileImage")
        .sort(sortMap[sortBy] || { createdAt: -1 })
        .skip((page - 1) * Number(limit))
        .limit(Number(limit))
        .lean(),
      Case.countDocuments(filter),
    ]);
    res.json({ success: true, cases, pagination: { total, page: Number(page), pages: Math.ceil(total / Number(limit)) } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/cases ──────────────────────────────────────────────────────────
router.post("/", restrictTo("client","admin"), async (req, res) => {
  try {
    const { title, description, category, location, country, budget, deadline, urgency } = req.body;
    if (!title || !description) return res.status(400).json({ success: false, message: "Title and description required" });

    const newCase = await Case.create({
      title, description, category: category || "General",
      location: location || "", country: country || "Pakistan",
      budget: parseFloat(budget) || 0,
      deadline: deadline ? new Date(deadline) : undefined,
      urgency: urgency || "medium",
      clientId: req.user._id, status: "open",
    });

    const populated = await Case.findById(newCase._id)
      .populate("clientId", "name profileImage email").lean();

    // Notify all lawyers about new case
    try {
      const lawyers = await User.find({ role: "lawyer" }).select("_id").lean();
      await Promise.all(lawyers.slice(0, 50).map(l =>
        createNotification({ userId: l._id, title: `New Case: ${title}`, body: description.slice(0,100), type: "case", meta: { caseId: newCase._id } })
      ));
    } catch {}

    res.status(201).json({ success: true, case: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/cases/:id ────────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const c = await Case.findById(req.params.id)
      .populate("clientId",           "name profileImage email")
      .populate("assignedLawyerId",   "name profileImage email lawyerProfile")
      .populate("proposals.lawyerId", "name profileImage lawyerProfile")
      .lean();
    if (!c) return res.status(404).json({ success: false, message: "Case not found" });
    res.json({ success: true, case: c });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── PUT /api/cases/:id ────────────────────────────────────────────────────────
router.put("/:id", async (req, res) => {
  try {
    const c = await Case.findById(req.params.id);
    if (!c) return res.status(404).json({ success: false, message: "Case not found" });
    const isOwner = String(c.clientId) === String(req.user._id);
    if (!isOwner && req.user.role !== "admin") return res.status(403).json({ success: false, message: "Not authorized" });
    ["title","description","category","location","country","budget","deadline","urgency","status"].forEach(f => {
      if (req.body[f] !== undefined) c[f] = req.body[f];
    });
    await c.save();
    res.json({ success: true, case: c });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── DELETE /api/cases/:id ────────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  try {
    const c = await Case.findById(req.params.id);
    if (!c) return res.status(404).json({ success: false, message: "Case not found" });
    if (String(c.clientId) !== String(req.user._id) && req.user.role !== "admin")
      return res.status(403).json({ success: false, message: "Not authorized" });
    await c.deleteOne();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/cases/:id/proposals — lawyer submits proposal ──────────────────
router.post("/:id/proposals", restrictTo("lawyer"), async (req, res) => {
  try {
    const c = await Case.findById(req.params.id);
    if (!c) return res.status(404).json({ success: false, message: "Case not found" });
    if (c.status !== "open") return res.status(400).json({ success: false, message: "Case is not open" });
    const exists = c.proposals?.find(p => String(p.lawyerId) === String(req.user._id));
    if (exists) return res.status(400).json({ success: false, message: "Already applied" });

    c.proposals = c.proposals || [];
    c.proposals.push({ lawyerId: req.user._id, message: req.body.message || "", fee: req.body.fee || 0, submittedAt: new Date() });
    await c.save();

    // Notify client
    try {
      await createNotification({ userId: c.clientId, title: `New Proposal from ${req.user.name}`, body: `A lawyer submitted a proposal on your case: ${c.title}`, type: "case", meta: { caseId: c._id, lawyerId: req.user._id } });
    } catch {}

    res.json({ success: true, case: c });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/cases/:id/accept — client accepts a proposal ───────────────────
router.post("/:id/accept", restrictTo("client"), async (req, res) => {
  try {
    const { lawyerId } = req.body;
    const c = await Case.findById(req.params.id);
    if (!c || String(c.clientId) !== String(req.user._id))
      return res.status(403).json({ success: false, message: "Not authorized" });

    c.assignedLawyerId = lawyerId;
    c.status           = "in-progress";
    if (c.proposals) c.proposals.forEach(p => { if (String(p.lawyerId) === lawyerId) p.status = "accepted"; });
    await c.save();

    try {
      await createNotification({ userId: lawyerId, title: "Proposal Accepted!", body: `Your proposal on "${c.title}" was accepted. You can now contact the client.`, type: "success", meta: { caseId: c._id } });
    } catch {}

    res.json({ success: true, case: c });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/cases/:id/assign — admin assigns case to lawyer ─────────────────
router.post("/:id/assign", restrictTo("admin"), async (req, res) => {
  try {
    const { lawyerId } = req.body;
    const c = await Case.findByIdAndUpdate(req.params.id,
      { assignedLawyerId: lawyerId, status: "in-progress" },
      { new: true }
    ).populate("assignedLawyerId", "name email");
    if (!c) return res.status(404).json({ success: false, message: "Case not found" });

    try {
      await Promise.all([
        createNotification({ userId: lawyerId,  title: "Case Assigned", body: `Admin assigned you to: ${c.title}`, type: "case", meta: { caseId: c._id } }),
        createNotification({ userId: c.clientId,title: "Lawyer Assigned", body: `A lawyer has been assigned to your case: ${c.title}`, type: "success", meta: { caseId: c._id } }),
      ]);
    } catch {}

    res.json({ success: true, case: c });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;