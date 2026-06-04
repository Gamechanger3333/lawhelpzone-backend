// backend/src/models/CallLog.js
import mongoose from "mongoose";

const callLogSchema = new mongoose.Schema(
  {
    caller:    { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    receiver:  { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    status:    { type: String, enum: ["missed", "answered", "rejected"], default: "missed" },
    startedAt: { type: Date },
    endedAt:   { type: Date },
    duration:  { type: Number, default: 0 }, // seconds
    type:      { type: String, enum: ["video", "audio"], default: "video" },
  },
  { timestamps: true }
);

export default mongoose.models.CallLog || mongoose.model("CallLog", callLogSchema);