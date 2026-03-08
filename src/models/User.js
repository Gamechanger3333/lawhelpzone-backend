// backend/src/models/User.js
import mongoose from "mongoose";
import bcrypt    from "bcryptjs";
import crypto    from "crypto";
import validator from "validator";

const lawyerProfileSchema = new mongoose.Schema({
  barNumber:         { type: String,   default: "" },
  barCouncil:        { type: String,   default: "" },
  jurisdiction:      { type: String,   default: "" },
  yearsOfExperience: { type: Number,   default: 0 },
  hourlyRate:        { type: Number,   default: 0, min: 0 },
  currency:          { type: String,   default: "USD" },
  consultationFee:   { type: Number,   default: 0, min: 0 },
  isAvailable:       { type: Boolean,  default: true },
  totalCasesHandled: { type: String,   default: "" },
  successRate:       { type: String,   default: "" },
  rating:            { type: Number,   default: 0, min: 0, max: 5 },
  totalReviews:      { type: Number,   default: 0 },
  education:         { type: String,   default: "" },
  university:        { type: String,   default: "" },
  graduationYear:    { type: String,   default: "" },
  officeAddress:     { type: String,   default: "" },
  website:           { type: String,   default: "" },
  linkedIn:          { type: String,   default: "" },
  bio:               { type: String,   default: "", maxlength: 1000 },
  specializations:   { type: [String], default: [] },
  languages:         { type: [String], default: [] },
  courts:            { type: [String], default: [] },
}, { _id: false });

const clientProfileSchema = new mongoose.Schema({
  legalNeeds:        { type: [String], default: [] },
  preferredLanguage: { type: String,   default: "English" },
  occupation:        { type: String,   default: "" },
  employer:          { type: String,   default: "" },
  income:            { type: String,   default: "" },
  emergencyContact:  { type: String,   default: "" },
  notes:             { type: String,   default: "" },
}, { _id: false });

const userSchema = new mongoose.Schema(
  {
    name: {
      type:      String,
      required:  [true, "Name is required"],
      trim:      true,
      minlength: [2,  "Name must be at least 2 characters"],
      maxlength: [50, "Name cannot exceed 50 characters"],
    },
    email: {
      type:      String,
      required:  [true, "Email is required"],
      unique:    true,
      lowercase: true,
      trim:      true,
      validate:  [validator.isEmail, "Please provide a valid email"],
    },
    password: {
      type:      String,
      required:  [true, "Password is required"],
      minlength: [8, "Password must be at least 8 characters"],
      select:    false,
    },
    role: {
      type:    String,
      enum:    ["client", "lawyer", "admin"],
      default: "client",
    },
    passwordChangedAt:        Date,
    passwordResetToken:       { type: String, select: false },
    passwordResetExpires:     Date,
    emailVerificationToken:   { type: String, select: false },
    emailVerificationExpires: Date,
    refreshToken:             { type: String, select: false },
    verified:      { type: Boolean, default: false },
    emailVerified: { type: Boolean, default: false },
    active:        { type: Boolean, default: true },
    suspended:     { type: Boolean, default: false },
    suspensionReason: String,
    profileImage: { type: String, default: "" },
    phone: {
      type:     String,
      validate: {
        validator: (v) => !v || validator.isMobilePhone(v, "any", { strictMode: false }),
        message:   "Invalid phone number",
      },
    },
    bio:        { type: String, default: "", maxlength: 1000 },
    city:       { type: String, default: "" },
    country:    { type: String, default: "" },
    address:    { type: String, default: "" },
    dob:        { type: String, default: "" },
    gender:     { type: String, default: "" },
    nationalId: { type: String, default: "" },
    isOnline:   { type: Boolean, default: false },
    lastSeen:   { type: Date,    default: Date.now },
    location: {
      type:        { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number], default: [0, 0] },
    },
    loginAttempts: { type: Number, default: 0 },
    lockUntil:     Date,
    lastLogin:     Date,
    loginHistory: [
      {
        ip:        String,
        userAgent: String,
        loginAt:   { type: Date, default: Date.now },
      },
    ],
    lawyerProfile: { type: lawyerProfileSchema, default: () => ({}) },
    clientProfile: { type: clientProfileSchema, default: () => ({}) },
    department:  { type: String, default: "" },
    employeeId:  { type: String, default: "" },
    supervisor:  { type: String, default: "" },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

userSchema.index({ role: 1 });
userSchema.index({ location: "2dsphere" });
userSchema.index({ "lawyerProfile.specializations": 1 });
userSchema.index({ "lawyerProfile.rating": -1 });
userSchema.index({ createdAt: -1 });

userSchema.virtual("isLocked").get(function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 12);
  if (!this.isNew) this.passwordChangedAt = Date.now() - 1000;
  next();
});

userSchema.methods.comparePassword = function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.createPasswordResetToken = function () {
  const token = crypto.randomBytes(32).toString("hex");
  this.passwordResetToken   = crypto.createHash("sha256").update(token).digest("hex");
  this.passwordResetExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
  return token;
};

userSchema.methods.createEmailVerificationToken = function () {
  const token = crypto.randomBytes(32).toString("hex");
  this.emailVerificationToken   = crypto.createHash("sha256").update(token).digest("hex");
  this.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
  return token;
};

export default mongoose.model("User", userSchema);
