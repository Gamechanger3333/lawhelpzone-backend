// backend/src/models/Case.js
import mongoose from "mongoose";

const caseSchema = new mongoose.Schema({
  title: {
    type:      String,
    required:  [true, "Case title is required"],
    trim:      true,
    minlength: [10,  "Title must be at least 10 characters"],
    maxlength: [200, "Title must be less than 200 characters"],
  },
  description: {
    type:      String,
    required:  [true, "Case description is required"],
    minlength: [50, "Description must be at least 50 characters"],
  },
  category: {
    type:     String,
    required: [true, "Category is required"],
    enum: [
      "Business Law", "Criminal Law", "Family Law", "Immigration Law",
      "Real Estate Law", "Employment Law", "Intellectual Property",
      "Corporate Law", "Tax Law", "Contract Law",
    ],
  },
  location: { type: String, required: [true, "Location is required"], trim: true },
  country:  { type: String, required: [true, "Country is required"],  trim: true },
  budget:   { type: Number, required: [true, "Budget is required"],   min: [0, "Budget must be positive"] },
  deadline: { type: Date,   required: [true, "Deadline is required"] },
  urgency:  { type: String, enum: ["low", "medium", "high", "urgent"],            default: "medium" },
  status:   { type: String, enum: ["open", "in-progress", "closed", "cancelled"], default: "open" },
  clientId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      "User",
    required: true,
  },
  assignedLawyerId: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     "User",
    default: null,
  },
  proposals: [
    {
      lawyerId:         { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      message:          String,
      proposedBudget:   Number,
      proposedDeadline: Date,
      createdAt:        { type: Date, default: Date.now },
    },
  ],
}, { timestamps: true });

caseSchema.index({ status: 1, createdAt: -1 });
caseSchema.index({ category: 1 });
caseSchema.index({ country: 1 });
caseSchema.index({ clientId: 1 });

const Case = mongoose.model("Case", caseSchema);
export default Case;
