// backend/src/controllers/dashboardController.js
// Called by dashboardRoutes.js — GET /api/dashboard
import User         from "../models/User.js";
import Case         from "../models/Case.js";
import Message      from "../models/Message.js";
import Notification from "../models/Notification.js";

export const getDashboardData = async (req, res) => {
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

    // ── CLIENT ──────────────────────────────────────────────────────────────
    if (role === "client") {
      const [activeCases, totalCases, resolvedCases, assignedLawyerIds] = await Promise.all([
        Case.countDocuments({ clientId: uid, status: { $in: ["open", "in-progress"] } }),
        Case.countDocuments({ clientId: uid }),
        Case.countDocuments({ clientId: uid, status: "closed" }),
        Case.distinct("assignedLawyerId", { clientId: uid, assignedLawyerId: { $exists: true, $ne: null } }),
      ]);

      const [recentCases, myLawyers, allLawyers] = await Promise.all([
        Case.find({ clientId: uid })
          .populate("assignedLawyerId", "name email profileImage lawyerProfile")
          .populate("proposals.lawyerId", "name email profileImage")
          .sort({ updatedAt: -1 })
          .limit(6)
          .lean(),
        assignedLawyerIds.length
          ? User.find({ _id: { $in: assignedLawyerIds } }).select("name email profileImage lawyerProfile").lean()
          : [],
        User.find({ role: "lawyer" })
          .select("name email profileImage lawyerProfile")
          .sort({ "lawyerProfile.rating": -1 })
          .limit(12)
          .lean(),
      ]);

      return res.json({
        success: true,
        stats: { ...shared, activeCases, totalCases, resolvedCases, lawyers: assignedLawyerIds.length },
        recentCases,
        myLawyers,
        allLawyers,
        recentNotifications,
      });
    }

    // ── LAWYER ──────────────────────────────────────────────────────────────
    if (role === "lawyer") {
      const [activeCases, closedCases, openAvailable, proposalsSent, clientIds] = await Promise.all([
        Case.countDocuments({ assignedLawyerId: uid, status: { $in: ["open", "in-progress"] } }),
        Case.countDocuments({ assignedLawyerId: uid, status: "closed" }),
        Case.countDocuments({ status: "open", $or: [{ assignedLawyerId: { $exists: false } }, { assignedLawyerId: null }] }),
        Case.countDocuments({ "proposals.lawyerId": uid }),
        Case.distinct("clientId", { assignedLawyerId: uid }),
      ]);

      const [myCases, myClients] = await Promise.all([
        Case.find({ assignedLawyerId: uid })
          .populate("clientId", "name email profileImage")
          .sort({ updatedAt: -1 })
          .limit(10)
          .lean(),
        clientIds.length
          ? User.find({ _id: { $in: clientIds } })
              .select("name email profileImage role isOnline lastSeen phone city country")
              .lean()
          : [],
      ]);

      return res.json({
        success: true,
        stats: { ...shared, activeCases, closedCases, openAvailable, proposalsSent, totalClients: clientIds.length },
        myCases,
        myClients,
        lawyerProfile: req.user.lawyerProfile,
        recentNotifications,
      });
    }

    // ── ADMIN ────────────────────────────────────────────────────────────────
    if (role === "admin") {
      const start = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

      const [
        totalUsers, totalLawyers, totalClients,
        totalCases, thisMonthCases, openCases,
        recentUsers, recentCases,
      ] = await Promise.all([
        User.countDocuments(),
        User.countDocuments({ role: "lawyer" }),
        User.countDocuments({ role: "client" }),
        Case.countDocuments(),
        Case.countDocuments({ createdAt: { $gte: start } }),
        Case.countDocuments({ status: "open" }),
        User.find().sort({ createdAt: -1 }).limit(20)
          .select("name email role createdAt suspended profileImage")
          .lean(),
        Case.find().sort({ createdAt: -1 }).limit(10)
          .populate("clientId",         "name email profileImage")
          .populate("assignedLawyerId", "name email profileImage")
          .lean(),
      ]);

      return res.json({
        success: true,
        stats: { ...shared, totalUsers, totalLawyers, totalClients, totalCases, thisMonthCases, openCases },
        recentUsers,
        recentCases,
        recentNotifications,
      });
    }

    res.json({ success: true, stats: shared });
  } catch (err) {
    console.error("Dashboard error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};