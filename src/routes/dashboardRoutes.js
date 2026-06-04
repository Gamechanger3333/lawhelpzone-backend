// backend/src/routes/dashboardRoutes.js
// GET /api/dashboard — role-specific stats for admin | lawyer | client
//
// NOTE: allUsers was removed from this response.
// Contact lists for messages/video-calls are served by GET /api/messages/users
// which is already implemented in chatRoutes.js. Fetching all users on every
// dashboard load caused the 488ms proxy delay seen in server logs.

import express from "express";
import User         from "../models/User.js";
import Case         from "../models/Case.js";
import Message      from "../models/Message.js";
import Notification from "../models/Notification.js";
import { protect }  from "../middleware/authMiddleware.js";

const router = express.Router();
router.use(protect);

router.get("/", async (req, res) => {
  try {
    const uid  = req.user._id;
    const role = req.user.role;

    // Shared across all roles
    const [unreadMessages, recentNotifications] = await Promise.all([
      Message.countDocuments({ receiverId: uid, read: false }).catch(() => 0),
      Notification.find({ userId: uid }).sort({ createdAt: -1 }).limit(5).lean().catch(() => []),
    ]);

    const unreadNotifications = recentNotifications.filter(n => !n.read).length;
    const shared = { unreadMessages, unreadNotifications };

    // ── ADMIN ───────────────────────────────────────────────────────────────
    if (role === "admin") {
      const start = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

      const [
        totalUsers, totalLawyers, totalClients,
        openCases, activeCases, closedCases, totalCases,
        thisMonthCases, pendingLawyers,
        recentCases, recentUsers,
      ] = await Promise.all([
        User.countDocuments(),
        User.countDocuments({ role: "lawyer" }),
        User.countDocuments({ role: "client" }),
        Case.countDocuments({ status: "open" }),
        Case.countDocuments({ status: "in-progress" }),
        Case.countDocuments({ status: "closed" }),
        Case.countDocuments(),
        Case.countDocuments({ createdAt: { $gte: start } }),
        User.countDocuments({ role: "lawyer", "lawyerProfile.verified": false }),
        Case.find()
          .populate("clientId",         "name email profileImage")
          .populate("assignedLawyerId", "name email profileImage")
          .sort({ updatedAt: -1 })
          .limit(10)
          .lean(),
        User.find()
          .select("name email role profileImage createdAt lawyerProfile.specializations")
          .sort({ createdAt: -1 })
          .limit(8)
          .lean(),
      ]);

      return res.json({
        success: true,
        stats: {
          ...shared,
          totalUsers, totalLawyers, totalClients,
          openCases, activeCases, closedCases, totalCases,
          thisMonthCases, pendingLawyers,
        },
        recentCases,
        recentUsers,
        recentNotifications,
      });
    }

    // ── LAWYER ──────────────────────────────────────────────────────────────
    if (role === "lawyer") {
      const [
        activeCases, closedCases, openAvailable, proposalsSent, clientIds,
        lawyerDoc,
      ] = await Promise.all([
        Case.countDocuments({ assignedLawyerId: uid, status: { $in: ["open", "in-progress"] } }),
        Case.countDocuments({ assignedLawyerId: uid, status: "closed" }),
        Case.countDocuments({ status: "open", $or: [{ assignedLawyerId: { $exists: false } }, { assignedLawyerId: null }] }),
        Case.countDocuments({ "proposals.lawyerId": uid }),
        Case.distinct("clientId", { assignedLawyerId: uid }),
        User.findById(uid).select("lawyerProfile name email profileImage").lean(),
      ]);

      const [myCases, myClients] = await Promise.all([
        Case.find({ assignedLawyerId: uid })
          .populate("clientId", "name email profileImage")
          .sort({ updatedAt: -1 })
          .limit(10)
          .lean(),
        User.find({ _id: { $in: clientIds } })
          .select("name email profileImage role createdAt")
          .lean(),
      ]);

      return res.json({
        success: true,
        stats: {
          ...shared,
          activeCases, closedCases, openAvailable,
          proposalsSent, totalClients: clientIds.length,
        },
        myCases,
        myClients,
        lawyerProfile: lawyerDoc?.lawyerProfile || {},
        recentNotifications,
      });
    }

    // ── CLIENT ──────────────────────────────────────────────────────────────
    const [activeCases, totalCases, resolvedCases, recentCases] = await Promise.all([
      Case.countDocuments({ clientId: uid, status: { $in: ["open", "in-progress"] } }),
      Case.countDocuments({ clientId: uid }),
      Case.countDocuments({ clientId: uid, status: "closed" }),
      Case.find({ clientId: uid })
        .populate("assignedLawyerId", "name email profileImage lawyerProfile")
        .populate("proposals.lawyerId", "name email profileImage lawyerProfile")
        .sort({ updatedAt: -1 })
        .limit(10)
        .lean(),
    ]);

    // Deduplicate assigned lawyers
    const seenIds = new Set();
    const myLawyers = recentCases
      .filter(c => c.assignedLawyerId)
      .map(c => c.assignedLawyerId)
      .filter(l => {
        const id = String(l._id);
        if (seenIds.has(id)) return false;
        seenIds.add(id);
        return true;
      });

    return res.json({
      success: true,
      stats: { ...shared, activeCases, totalCases, resolvedCases },
      recentCases,
      myLawyers,
      recentNotifications,
    });

  } catch (err) {
    console.error("Dashboard error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;