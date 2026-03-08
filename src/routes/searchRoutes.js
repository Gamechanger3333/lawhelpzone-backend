// backend/src/routes/searchRoutes.js
import express from "express";
import { optionalAuth } from "../middleware/authMiddleware.js";
import { searchLawyers, searchCases } from "../controllers/searchController.js";

const router = express.Router();

// These are semi-public: guests can search, logged-in users get richer results
router.get("/lawyers", optionalAuth, searchLawyers);
router.get("/cases",   optionalAuth, searchCases);

export default router;