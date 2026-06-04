// backend/src/utils/notificationService.js
// Single source of truth for creating notifications.
// Creates DB record + emits socket event in one call.
// Import this wherever you need to send a notification — never import from routes.
import Notification from "../models/Notification.js";
import { emitNotification } from "./socket.js";

export const createNotification = async ({
  userId,
  title,
  body,
  type = "system",  // must match Notification model enum — "info" is not valid
  link = "",
  meta = {},
}) => {
  try {
    const notification = await Notification.create({
      userId, title, body, message: body, type, link, meta,
    });
    emitNotification(userId.toString(), notification);
    return notification;
  } catch (err) {
    console.error("createNotification error:", err.message);
  }
};