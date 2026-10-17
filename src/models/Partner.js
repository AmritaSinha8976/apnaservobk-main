const mongoose = require("mongoose");
const encryptedFieldsPlugin = require("../utils/encryptedFieldsPlugin");
const { nextPublicId, publicIdPlugin } = require("../utils/publicIds");

const pointSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["Point"], default: "Point" },
    coordinates: { type: [Number], default: [0, 0] }
  },
  { _id: false }
);

const deviceTokenSchema = new mongoose.Schema(
  {
    token: { type: String, trim: true, default: "" },
    tokenHash: { type: String, trim: true, default: "", index: true },
    platform: { type: String, enum: ["android", "ios", "web"], default: "android" },
    deviceId: { type: String, trim: true, default: "" },
    publicId: { type: String, trim: true, default: "" },
    appType: { type: String, enum: ["partner"], default: "partner" },
    isActive: { type: Boolean, default: true, index: true },
    lastUpdatedAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now }
  },
  { _id: true }
);

const verificationHistorySchema = new mongoose.Schema(
  {
    action: {
      type: String,
      enum: ["submitted", "approved", "reapproved", "rejected", "blocked", "suspended"],
      required: true
    },
    at: { type: Date, default: Date.now },
    by: { type: String, trim: true, default: "admin" },
    note: { type: String, trim: true, default: "" }
  },
  { _id: true }
);

// ---------------------------------------------------------------------------
// Availability slot schema
// Partners declare which half-day windows they are ready to accept work for
// today and tomorrow.  Three named slots per day:
//   morning   → 06:00 – 12:00  IST
//   afternoon → 12:00 – 17:00  IST
//   evening   → 17:00 – 22:00  IST
//
// The array holds at most 2 entries (today + tomorrow keyed by "YYYY-MM-DD"
// in IST).  The availability controller prunes stale/past-date entries on
// every write so the array never grows beyond 2 documents.
// ---------------------------------------------------------------------------
const availabilitySlotSchema = new mongoose.Schema(
  {
    date: { type: String, trim: true, required: true }, // "YYYY-MM-DD" IST
    morning: { type: Boolean, default: false },
    afternoon: { type: Boolean, default: false },
    evening: { type: Boolean, default: false },
    updatedAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const laundryStaffSchema = new mongoose.Schema(
  {
    sequence: { type: Number, required: true, min: 1 },
    name: { type: String, trim: true, default: "" },
    phone: { type: String, trim: true, default: "" },
    phoneHash: { type: String, trim: true, default: "" },
    email: { type: String, trim: true, lowercase: true, default: "" },
    emailHash: { type: String, trim: true, default: "" },
    firebaseUid: { type: String, trim: true, default: "" },
    role: { type: String, trim: true, default: "Service Staff" },
    photoUrl: { type: String, trim: true, default: "" },
    verificationStatus: {
      type: String,
      enum: ["pending_review", "verified", "rejected", "blocked"],
      default: "pending_review"
    },
    isOnline: { type: Boolean, default: false },
    fcmToken: { type: String, trim: true, default: "" },
    lastLoginAt: { type: Date, default: null },
    idNumber: { type: String, trim: true, default: "" },
    idType: { type: String, trim: true, default: "" },
    documentType: { type: String, trim: true, default: "" },
    documentTitle: { type: String, trim: true, default: "" },
    createdAt: { type: Date, default: Date.now },
    welcomeEmailSentAt: { type: Date, default: null }
  },
  { _id: false }
);

laundryStaffSchema.plugin(encryptedFieldsPlugin, {
  fields: ["name", "phone", "email", "role", "photoUrl", "fcmToken", "idNumber", "documentTitle"]
});

const laundryBusinessSchema = new mongoose.Schema(
  {
    shopName: { type: String, trim: true, default: "" },
    shopLicenseNumber: { type: String, trim: true, default: "" },
    shopLocation: { type: String, trim: true, default: "" },
    ownerName: { type: String, trim: true, default: "" },
    ownerPhone: { type: String, trim: true, default: "" },
    staffMembers: { type: [laundryStaffSchema], default: [] }
  },
  { _id: false }
);

laundryBusinessSchema.plugin(encryptedFieldsPlugin, {
  fields: ["shopName", "shopLicenseNumber", "shopLocation", "ownerName", "ownerPhone"]
});

const partnerSchema = new mongoose.Schema(
  {
    firebaseUid: { type: String, required: true, unique: true, index: true },
    partnerCode: { type: String, unique: true, sparse: true },
    name: { type: String, trim: true, default: "ApnaServo Partner" },
    phone: { type: String, trim: true, default: "" },
    phoneHash: { type: String, default: "" },
    email: { type: String, trim: true, lowercase: true, default: "" },
    emailHash: { type: String, default: "" },
    welcomeEmailSentAt: { type: Date, default: null },
    approvalEmailSentVersion: { type: Number, default: 0 },
    dateOfBirth: { type: String, trim: true, default: "" },
    gender: { type: String, trim: true, default: "" },
    residentialAddress: { type: String, trim: true, default: "" },
    state: { type: String, trim: true, default: "" },
    pinCode: { type: String, trim: true, default: "" },
    emergencyContactNumber: { type: String, trim: true, default: "" },
    serviceCategory: { type: [String], default: [] },
    yearsOfExperience: { type: Number, default: 0 },
    workingAreas: { type: [String], default: [] },
    languagesKnown: { type: [String], default: [] },
    businessType: { type: String, enum: ["", "laundry"], default: "", index: true },
    businessVerificationStatus: {
      type: String,
      enum: ["not_required", "pending_review", "approved", "rejected"],
      default: "not_required",
      index: true
    },
    laundryBusiness: { type: laundryBusinessSchema, default: undefined },
    termsConsent: {
      accepted: { type: Boolean, default: false },
      version: { type: String, default: "" },
      acceptedAt: { type: Date, default: null },
      clientAcceptedAt: { type: Date, default: null },
      registrationFlow: { type: String, default: "" },
      serviceCategory: { type: String, default: "" },
      documentKey: { type: String, default: "partner_terms" },
      sourceApp: { type: String, default: "" },
      ipAddress: { type: String, default: "" },
      userAgent: { type: String, default: "" }
    },
    termsAcceptanceHistory: [{
      accepted: { type: Boolean, default: true },
      version: String,
      acceptedAt: Date,
      clientAcceptedAt: Date,
      registrationFlow: String,
      serviceCategory: String,
      documentKey: String,
      sourceApp: String
    }],
    isOnline: { type: Boolean, default: true, index: true },
    isVerified: { type: Boolean, default: false },
    city: { type: String, trim: true, default: "Guwahati" },
    serviceArea: { type: String, trim: true, default: "Guwahati, Assam" },
    serviceRadiusKm: { type: Number, default: 8, min: 8, max: 8 },
    location: { type: pointSchema, default: () => ({ type: "Point", coordinates: [0, 0] }) },
    lastLocationAt: { type: Date, default: null },
    lastLocationAccuracy: { type: Number, default: 9999 },
    lastLocationProvider: { type: String, default: "" },
    locationTrustStatus: { type: String, enum: ["unknown", "trusted", "suspicious"], default: "unknown" },
    faceVerified: { type: Boolean, default: false },
    selfieVerified: { type: Boolean, default: false },
    selfieUrl: { type: String, default: "" },
    faceLivenessStatus: { type: String, enum: ["missing", "passed", "failed"], default: "missing", index: true },
    faceLivenessVerifiedAt: { type: Date, default: null },
    faceLivenessSessionId: { type: String, default: "" },
    faceLivenessChecks: {
      blink: { type: Boolean, default: false },
      lookLeft: { type: Boolean, default: false },
      lookRight: { type: Boolean, default: false },
      smile: { type: Boolean, default: false },
      turnHead: { type: Boolean, default: false },
      stepCount: { type: Number, default: 0 },
      source: { type: String, enum: ["video", ""], default: "" },
      videoDurationMs: { type: Number, default: 0 },
      videoFrameCount: { type: Number, default: 0 }
    },
    aadhaarLast4: { type: String, default: "" },
    aadhaarStatus: { type: String, enum: ["missing", "submitted", "verified", "rejected"], default: "missing", index: true },
    aadhaarVerified: { type: Boolean, default: false },
    idProofUrl: { type: String, default: "" },
    idProofStatus: { type: String, enum: ["missing", "submitted", "verified", "rejected"], default: "missing", index: true },
    skillCertificateUrl: { type: String, default: "" },
    skillCertificateStatus: { type: String, enum: ["missing", "submitted", "verified", "rejected"], default: "missing", index: true },
    kycStatus: { type: String, enum: ["missing", "pending_review", "verified", "rejected"], default: "missing", index: true },
    approvalVersion: { type: Number, default: 0 },
    approvedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },
    rejectionReason: { type: String, trim: true, default: "" },
    verificationHistory: { type: [verificationHistorySchema], default: [] },
    fraudWarningCount: { type: Number, default: 0 },
    trustStatus: { type: String, enum: ["trusted", "warning", "review_required", "suspended"], default: "review_required", index: true },
    lastFraudWarningAt: { type: Date, default: null },
    earnings: { type: Number, default: 0 },
    rating: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
    totalJobs: { type: Number, default: 0 },
    responseRate: { type: Number, default: 92 },
    fcmToken: { type: String, default: "" },
    legacyDevicePublicId: { type: String, trim: true, default: "" },
    deviceTokens: { type: [deviceTokenSchema], default: [] },
    photoUrl: { type: String, default: "" },
    profilePhotoAssetId: { type: mongoose.Schema.Types.ObjectId, ref: "PartnerUploadAsset", default: null },
    accountStatus: { type: String, enum: ["active", "inactive", "suspended", "blocked", "deletion_requested", "deleted"], default: "active", index: true },
    deletionRequestedAt: { type: Date, default: null },
    deletionReason: { type: String, trim: true, default: "" },

    // ---------------------------------------------------------------------
    // Partner monetization (subscription vs commission).
    //   billingModel:
    //     "commission"   → cleaning partners. No subscription; platform takes
    //                      a commission (cleaning_commission_rate) per job.
    //     "subscription" → everyone else. Flat monthly fee
    //                      (partner_subscription_amount) to keep receiving
    //                      bookings. Expiry gates dispatch.
    //   subscriptionStatus:
    //     "trial"   → inside the free launch window (trialEndsAt in future)
    //     "active"  → paid, subscriptionExpiresAt in the future
    //     "expired" → trial over and no active subscription
    //   trialEndsAt is set to createdAt + partner_free_trial_days when the
    //   partner profile is first created. During the trial everything is free
    //   for both models (0% commission for cleaning, no gate for subscription).
    // Values 299 / 0.25 / 10 live in PlatformSetting, never hardcoded here.
    // ---------------------------------------------------------------------
    billingModel: { type: String, enum: ["subscription", "commission"], default: "subscription", index: true },
    subscriptionStatus: { type: String, enum: ["trial", "active", "expired"], default: "trial", index: true },
    subscriptionExpiresAt: { type: Date, default: null },
    trialEndsAt: { type: Date, default: null },

    // Partner-declared availability for today + tomorrow.
    // Populated when the partner logs in / goes online via PUT /partners/availability.
    // Each entry covers one calendar date with three boolean slot flags.
    availability: { type: [availabilitySlotSchema], default: [] }
  },
  { timestamps: true }
);

partnerSchema.index({ location: "2dsphere" });
partnerSchema.index({ serviceCategory: 1, isOnline: 1, city: 1 });
partnerSchema.index({ serviceCategory: 1, isOnline: 1, isVerified: 1, trustStatus: 1, city: 1 });
partnerSchema.index({ isOnline: 1, lastLocationAt: -1 });
partnerSchema.index({ kycStatus: 1, faceVerified: 1, selfieVerified: 1, aadhaarVerified: 1 });
partnerSchema.index({ accountStatus: 1, deletionRequestedAt: -1 });
partnerSchema.index({ kycStatus: 1, approvedAt: -1, rejectedAt: -1 });
partnerSchema.index({ phoneHash: 1 }, { unique: true, partialFilterExpression: { phoneHash: { $type: "string", $gt: "" } } });
partnerSchema.index({ emailHash: 1 }, { unique: true, partialFilterExpression: { emailHash: { $type: "string", $gt: "" } } });
partnerSchema.index({ "deviceTokens.tokenHash": 1, "deviceTokens.isActive": 1 });
partnerSchema.index({ "laundryBusiness.staffMembers.phoneHash": 1 });
partnerSchema.index({ "laundryBusiness.staffMembers.emailHash": 1 });
partnerSchema.index({ "laundryBusiness.staffMembers.firebaseUid": 1 });
// Index for scheduled-booking dispatch: find available partners for a given date
partnerSchema.index({ "availability.date": 1, isOnline: 1, accountStatus: 1 });
// Subscription-gate lookups during booking dispatch.
partnerSchema.index({ billingModel: 1, subscriptionStatus: 1, subscriptionExpiresAt: 1 });
partnerSchema.plugin(publicIdPlugin, { kind: "partner" });
partnerSchema.pre("validate", async function assignDevicePublicIds() {
  if (this.fcmToken && !this.legacyDevicePublicId) this.legacyDevicePublicId = await nextPublicId("partnerDevice");
  for (const device of this.deviceTokens || []) {
    if (!device.publicId) device.publicId = await nextPublicId("partnerDevice");
  }
});
partnerSchema.post("findOneAndUpdate", async function assignLegacyDevicePublicId(partner) {
  if (!partner?.fcmToken || partner.legacyDevicePublicId) return;
  const value = await nextPublicId("partnerDevice");
  await this.model.updateOne({ _id: partner._id, legacyDevicePublicId: { $in: [null, ""] } }, { $set: { legacyDevicePublicId: value } });
  partner.legacyDevicePublicId = value;
});
partnerSchema.plugin(encryptedFieldsPlugin, {
  fields: ["name", "phone", "email", "dateOfBirth", "gender", "residentialAddress", "state", "pinCode", "emergencyContactNumber", "workingAreas", "languagesKnown", "serviceArea", "fcmToken", "deviceTokens.token", "deviceTokens.deviceId", "photoUrl", "selfieUrl", "faceLivenessSessionId", "aadhaarLast4", "idProofUrl", "skillCertificateUrl", "deletionReason", "rejectionReason"]
});

module.exports = mongoose.model("Partner", partnerSchema);
