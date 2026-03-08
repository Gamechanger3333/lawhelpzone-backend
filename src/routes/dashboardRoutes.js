// backend/src/routes/dashboardRoutes.js
// GET /api/dashboard  — unified for admin | lawyer | client
// Returns role-specific stats + all registered users + recent cases + notifications preview

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

    // ── Shared: unread message count ──────────────────────────────────────────
    const unreadMessages = await Message.countDocuments({ receiverId: uid, read: false }).catch(() => 0);

    // ── Shared: recent notifications (5) ─────────────────────────────────────
    const recentNotifications = await Notification.find({ userId: uid })
      .sort({ createdAt: -1 }).limit(5).lean().catch(() => []);

    const unreadNotifications = recentNotifications.filter(n => !n.read).length;

    // ── All registered users (for messages / video-call contact list) ─────────
    // Returns ALL users except current user so any role can message/call anyone
    const allUsers = await User.find({ _id: { $ne: uid } })
      .select("name email role profileImage lawyerProfile.specializations lawyerProfile.rating lawyerProfile.isAvailable createdAt isOnline")
      .sort({ role: 1, name: 1 })
      .lean();

    // Separate lawyers list for convenience
    const allLawyers = allUsers.filter(u => u.role === "lawyer");
    const allClients = allUsers.filter(u => u.role === "client");

    // ── ADMIN ─────────────────────────────────────────────────────────────────
    if (role === "admin") {
      const now   = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1);

      const [
        totalUsers, totalLawyers, totalClients,
        openCases, activeCases, closedCases, totalCases,
        thisMonthCases, pendingLawyers,
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
      ]);

      const recentCases = await Case.find()
        .populate("clientId",         "name email profileImage")
        .populate("assignedLawyerId", "name email profileImage")
        .sort({ updatedAt: -1 })
        .limit(10)
        .lean();

      const recentUsers = await User.find()
        .select("name email role profileImage createdAt lawyerProfile.specializations")
        .sort({ createdAt: -1 })
        .limit(8)
        .lean();

      return res.json({
        success: true,
        stats: {
          totalUsers, totalLawyers, totalClients,
          openCases, activeCases, closedCases, totalCases,
          thisMonthCases, pendingLawyers,
          unreadMessages, unreadNotifications,
        },
        recentCases,
        recentUsers,
        allUsers,
        allLawyers,
        allClients,
        recentNotifications,
      });
    }

    // ── LAWYER ────────────────────────────────────────────────────────────────
    if (role === "lawyer") {
      const [
        activeCases, closedCases,
        openAvailable,
      ] = await Promise.all([
        Case.countDocuments({ assignedLawyerId: uid, status: { $in: ["open", "in-progress"] } }),
        Case.countDocuments({ assignedLawyerId: uid, status: "closed" }),
        Case.countDocuments({ status: "open", $or: [{ assignedLawyerId: { $exists: false } }, { assignedLawyerId: null }] }),
      ]);

      // Unique clients from lawyer's cases
      const clientIds = await Case.distinct("clientId", { assignedLawyerId: uid });
      const totalClients = clientIds.length;

      // Count proposals sent by this lawyer
      const proposalsSent = await Case.countDocuments({ "proposals.lawyerId": uid });

      // My cases (recent 10)
      const myCases = await Case.find({ assignedLawyerId: uid })
        .populate("clientId", "name email profileImage")
        .sort({ updatedAt: -1 })
        .limit(10)
        .lean();

      // My clients (populated)
      const myClients = await User.find({ _id: { $in: clientIds } })
        .select("name email profileImage role createdAt")
        .lean();

      // Lawyer's own profile
      const lawyerDoc = await User.findById(uid)
        .select("lawyerProfile name email profileImage")
        .lean();

      return res.json({
        success: true,
        stats: {
          activeCases, closedCases, totalClients,
          proposalsSent, openAvailable,
          unreadMessages, unreadNotifications,
        },
        myCases,
        myClients,
        allUsers,          // ALL registered users for messages/video-calls
        allLawyers,        // all lawyers (excluding self)
        lawyerProfile: lawyerDoc?.lawyerProfile || {},
        recentNotifications,
      });
    }

    // ── CLIENT ────────────────────────────────────────────────────────────────
    {
      const [
        activeCases, totalCases, resolvedCases,
      ] = await Promise.all([
        Case.countDocuments({ clientId: uid, status: { $in: ["open", "in-progress"] } }),
        Case.countDocuments({ clientId: uid }),
        Case.countDocuments({ clientId: uid, status: "closed" }),
      ]);

      // Client's recent cases (with proposals + assigned lawyer)
      const recentCases = await Case.find({ clientId: uid })
        .populate("assignedLawyerId", "name email profileImage lawyerProfile")
        .populate("proposals.lawyerId", "name email profileImage lawyerProfile")
        .sort({ updatedAt: -1 })
        .limit(10)
        .lean();

      // Lawyers assigned to this client's cases
      const assignedLawyerIds = recentCases
        .filter(c => c.assignedLawyerId)
        .map(c => c.assignedLawyerId);
      const seenIds = new Set();
      const myLawyers = assignedLawyerIds.filter(l => {
        const id = String(l._id);
        if (seenIds.has(id)) return false;
        seenIds.add(id); return true;
      });

      return res.json({
        success: true,
        stats: {
          activeCases, totalCases, resolvedCases,
          unreadMessages, unreadNotifications,
        },
        recentCases,
        myLawyers,          // lawyers on THIS client's cases
        allLawyers,         // ALL registered lawyers for browsing/contacting
        allUsers,           // all users for messages/video-calls
        recentNotifications,
      });
    }
  } catch (err) {
    console.error("Dashboard error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;