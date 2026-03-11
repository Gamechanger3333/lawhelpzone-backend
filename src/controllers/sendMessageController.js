export const sendMessage = async (req, res) => {
  try {
    const { receiverId, content, fileUrl, fileName, type, replyToId } = req.body;
    const senderId = req.user._id;

    // ── Your existing message save logic ──────────────────────────────────
    // const message = await Message.create({ senderId, receiverId, content, ... });

    // ── ADD THIS after saving: email + in-app notification ────────────────

    // 1. Save in-app notification to DB (if you have a Notification model)
    try {
      await Notification.create({
        userId:    receiverId,
        type:      "new_message",
        title:     `New message from ${req.user.name || req.user.email}`,
        message:   content ? (content.length > 100 ? content.slice(0, 100) + "…" : content) : "Sent you a file",
        data:      { senderId, messageId: message._id },
        read:      false,
      });
    } catch (notifErr) {
      console.error("Notification save failed (non-fatal):", notifErr.message);
    }

    // 2. Send email notification (fire & forget — don't await, don't block)
    sendMessageEmailNotification({
      receiverId: receiverId.toString(),
      senderName:  req.user.name  || req.user.email || "A user",
      senderEmail: req.user.email,
      preview:     content || null,
    }).catch(() => {}); // completely silent failure

    // ── Your existing response ────────────────────────────────────────────
    // return res.status(201).json({ success: true, message });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
