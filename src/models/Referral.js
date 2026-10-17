const mongoose = require("mongoose");

// One document per (referrer, referred) pair.
// completedJobCount tracks how many of the referred partner's jobs
// have been counted toward eligibility (max ELIGIBILITY_THRESHOLD).
const referralSchema = new mongoose.Schema(
  {
    referrerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Partner",
      required: true,
      index: true
    },
    referredPartnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Partner",
      required: true,
      index: true
    },
    referralCode: { type: String, trim: true, required: true, index: true },
    // pending   → referred partner registered but has 0 completed jobs
    // in_progress → 1 or 2 completed jobs
    // eligible  → 3+ completed jobs; referrer may claim reward
    status: {
      type: String,
      enum: ["pending", "in_progress", "eligible"],
      default: "pending",
      index: true
    },
    completedJobCount: { type: Number, default: 0, min: 0 }
  },
  { timestamps: true }
);

// Prevent duplicate referrals for the same pair.
referralSchema.index({ referrerId: 1, referredPartnerId: 1 }, { unique: true });

const ELIGIBILITY_THRESHOLD = 3;

referralSchema.statics.ELIGIBILITY_THRESHOLD = ELIGIBILITY_THRESHOLD;

module.exports = mongoose.model("Referral", referralSchema);
