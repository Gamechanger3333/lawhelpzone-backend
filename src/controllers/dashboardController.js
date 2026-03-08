// backend/src/controllers/dashboardController.js
import User from "../models/User.js";
import Case from "../models/Case.js";

const getNotifModel = async () => {
  try { return (await import("../models/Notification.js")).default; }
  catch { return null; }
};

const getConvModel = async () => {
  try { return (await import("../models/Conversation.js")).default; }
  catch { return null; }
};

export const getDashboardData = async (req, res) => {
  try {
    const userId = req.user._id;
    const role   = req.user.role;

    // ── Client ────────────────────────────────────────────────────────────────
    if (role === "client") {
      const Conversation = await getConvModel();
      let unreadMessages = 0;
      if (Conversation) {
        try {
          const convs = await Conversation.find({ participants: userId }).lean();
          convs.forEach(c => {
            if (c.unreadCount && typeof c.unreadCount === "object") {
              unreadMessages += c.unreadCount[userId.toString()] || 0;
            }
            if (Array.isArray(c.unreadCounts)) {
              const e = c.unreadCounts.find(u => u.userId?.toString() === userId.toString());
              if (e) unreadMessages += e.count || 0;
            }
          });
        } catch (e) { /* non-fatal */ }
      }

      const [activeCases, totalCases, resolvedCases, assignedLawyerIds] = await Promise.all([
        Case.countDocuments({ clientId: userId, status: { $in: ["open", "in-progress"] } }),
        Case.countDocuments({ clientId: userId }),
        Case.countDocuments({ clientId: userId, status: "closed" }),
        Case.distinct("assignedLawyerId", { clientId: userId, assignedLawyerId: { $exists: true, $ne: null } }),
      ]);

      const recentCases = await Case.find({ clientId: userId })
        .sort({ updatedAt: -1 })
        .limit(6)
        .populate("assignedLawyerId", "name email profileImage lawyerProfile")
        .populate("proposals.lawyerId", "name email profileImage")
        .lean();

      const myLawyers = assignedLawyerIds.length > 0
        ? await User.find({ _id: { $in: assignedLawyerIds } })
            .select("name email profileImage lawyerProfile")
            .lean()
        : [];

      const allLawyers = await User.find({ role: "lawyer" })
        .select("name email profileImage lawyerProfile")
        .sort({ "lawyerProfile.rating": -1, createdAt: -1 })
        .limit(12)
        .lean();

      // Notifications
      const Notification = await getNotifModel();
      let recentNotifications = [];
      let unreadNotifications = 0;
      if (Notification) {
        try {
          recentNotifications = await Notification.find({ userId })
            .sort({ createdAt: -1 }).limit(5).lean();
          unreadNotifications = await Notification.countDocuments({ userId, read: false });
        } catch {}
      }

      return res.json({
        success: true,
        stats: { activeCases, totalCases, resolvedCases, unreadMessages, lawyers: assignedLawyerIds.length, unreadNotifications },
        recentCases,
        myLawyers,
        allLawyers,
        recentNotifications,
      });
    }

    // ── Lawyer ────────────────────────────────────────────────────────────────
    if (role === "lawyer") {
      const [activeCases, closedCases, openOpportunities, clientIds, proposalCount] = await Promise.all([
        Case.countDocuments({ assignedLawyerId: userId, status: { $in: ["open", "in-progress"] } }),
        Case.countDocuments({ assignedLawyerId: userId, status: "closed" }),
        Case.countDocuments({
          status: "open",
          $or: [{ assignedLawyerId: { $exists: false } }, { assignedLawyerId: null }],
        }),
        Case.distinct("clientId", { assignedLawyerId: userId }),
        Case.countDocuments({ "proposals.lawyerId": userId }),
      ]);

      const myCases = await Case.find({ assignedLawyerId: userId })
        .sort({ updatedAt: -1 })
        .limit(10)
        .populate("clientId", "name email profileImage")
        .lean();

      const availableCases = await Case.find({
        status: "open",
        $or: [{ assignedLawyerId: { $exists: false } }, { assignedLawyerId: null }],
      })
        .sort({ createdAt: -1 })
        .limit(20)
        .populate("clientId", "name email profileImage")
        .lean();

      // My clients (users linked via cases)
      const myClients = clientIds.length > 0
        ? await User.find({ _id: { $in: clientIds } })
            .select("name email profileImage role isOnline lastSeen phone city country")
            .lean()
        : [];

      // All registered users (for messaging/calling)
      const allUsers = await User.find({ _id: { $ne: userId } })
        .select("name email profileImage role isOnline lastSeen lawyerProfile.specializations")
        .sort({ createdAt: -1 })
        .limit(100)
        .lean();

      // Notifications
      const Notification = await getNotifModel();
      let recentNotifications = [];
      let unreadNotifications = 0;
      if (Notification) {
        try {
          recentNotifications = await Notification.find({ userId })
            .sort({ createdAt: -1 }).limit(5).lean();
          unreadNotifications = await Notification.countDocuments({ userId, read: false });
        } catch {}
      }

      return res.json({
        success: true,
        stats: {
          activeCases,
          closedCases,
          totalClients: clientIds.length,
          openOpportunities,
          openAvailable: openOpportunities,
          proposalsSent: proposalCount,
          unreadMessages: 0,
          unreadNotifications,
        },
        myCases,
        myClients,
        availableCases,
        allUsers,
        recentNotifications,
        lawyerProfile: req.user.lawyerProfile,
      });
    }

    // ── Admin ─────────────────────────────────────────────────────────────────
    if (role === "admin") {
      const now   = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1);

      const [totalUsers, totalLawyers, totalClients, thisMonthCases, openCases] = await Promise.all([
        User.countDocuments(),
        User.countDocuments({ role: "lawyer" }),
        User.countDocuments({ role: "client" }),
        Case.countDocuments({ createdAt: { $gte: start } }),
        Case.countDocuments({ status: "open" }),
      ]);

      const recentUsers = await User.find()
        .sort({ createdAt: -1 })
        .limit(20)
        .select("name email role createdAt suspended isVerified profileImage")
        .lean();

      const recentCases = await Case.find()
        .sort({ createdAt: -1 })
        .limit(10)
        .populate("clientId", "name email profileImage")
        .populate("assignedLawyerId", "name email profileImage")
        .populate("proposals.lawyerId", "name email")
        .lean();

      const lawyers = await User.find({ role: "lawyer" })
        .select("name email profileImage lawyerProfile")
        .lean();

      // Notifications
      const Notification = await getNotifModel();
      let recentNotifications = [];
      let unreadNotifications = 0;
      if (Notification) {
        try {
          recentNotifications = await Notification.find({ userId })
            .sort({ createdAt: -1 }).limit(5).lean();
          unreadNotifications = await Notification.countDocuments({ userId, read: false });
        } catch {}
      }

      return res.json({
        success: true,
        stats: { totalUsers, totalLawyers, totalClients, thisMonthCases, openCases, systemHealth: "99.9%", unreadNotifications },
        recentUsers,
        recentCases,
        lawyers,
        recentNotifications,
      });
    }

    res.json({ success: true, stats: {} });
  } catch (err) {
    console.error("Dashboard error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};