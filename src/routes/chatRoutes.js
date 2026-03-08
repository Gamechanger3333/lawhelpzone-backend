// backend/src/routes/chatRoutes.js
import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import {
  getContacts,
  getMessages,
  sendMessage,
  markRead,
} from "../controllers/chatController.js";

const router = express.Router();

router.use(protect);

router.get("/contacts",          getContacts);
router.get("/:contactId",        getMessages);
router.post("/",                 sendMessage);
router.patch("/:contactId/read", markRead);

export default router;