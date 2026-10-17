const router = require("express").Router();
const multer = require("multer");
const { verifyFirebaseToken } = require("../middleware/authMiddleware");
const { rejectPlainSensitiveFields } = require("../middleware/securityGuard");
const { fcmTokenLimiter, locationUpdateLimiter, profileWriteLimiter, verificationLimiter } = require("../middleware/securityRateLimits");
const { validateUploadedImage, validateUploadedDocument } = require("../utils/uploadSecurity");
const controller = require("../controllers/partnerController");
const referralController = require("../controllers/referralController");
const billingController = require("../controllers/partnerBillingController");

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(req, file, callback) {
    if (["image/jpeg", "image/jpg", "image/png"].includes(file.mimetype)) {
      return callback(null, true);
    }
    const error = new Error("Only JPG/PNG document images are allowed");
    error.status = 415;
    return callback(error);
  }
});

const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(req, file, callback) {
    if (["image/jpeg", "image/jpg", "image/png", "application/pdf", "application/x-pdf"].includes(file.mimetype)) {
      return callback(null, true);
    }
    const error = new Error("Only JPG, PNG, or PDF documents are allowed");
    error.status = 415;
    return callback(error);
  }
});

// Cashfree server-to-server webhook for partner subscriptions. Public (no
// Firebase token) and verified by signature inside the handler, so it is
// registered BEFORE the auth middleware below.
router.post("/billing/cashfree/webhook", billingController.cashfreeWebhook);

router.use(verifyFirebaseToken);

// Partner subscription billing (NEW Cashfree flow). Authenticated.
router.get("/billing/status", billingController.status);
router.post("/billing/cashfree/order", profileWriteLimiter, billingController.createCashfreeOrder);
router.post("/billing/cashfree/verify", profileWriteLimiter, billingController.verifyCashfreePayment);

router.post("/profile", profileWriteLimiter, controller.upsertProfile);
router.get("/me", controller.me);
router.get("/identity-card", controller.identityCard);
router.post("/staff/session", profileWriteLimiter, controller.staffSession);
router.get("/staff/bookings", controller.listStaffBookings);
router.patch("/staff/online", profileWriteLimiter, controller.setStaffOnline);
router.post("/laundry/staff", profileWriteLimiter, controller.addLaundryStaff);
// Service-scoped alias used by current Partner app. The controller applies
// owner/company service isolation before creating the staff record.
router.post("/services/laundry/staff", profileWriteLimiter, controller.addLaundryStaff);
router.get("/services/laundry/staff", controller.listLaundryStaff);
router.delete("/services/laundry/staff/:staffId", profileWriteLimiter, controller.removeLaundryStaff);
router.post("/services/cleaning/staff", profileWriteLimiter, controller.addLaundryStaff);
router.get("/services/cleaning/staff", controller.listLaundryStaff);
router.delete("/services/cleaning/staff/:staffId", profileWriteLimiter, controller.removeLaundryStaff);
router.post("/laundry/staff/:staffSequence/photo", verificationLimiter, imageUpload.single("photo"), validateUploadedImage(["image/jpeg", "image/png"]), controller.uploadLaundryStaffPhoto);
router.post("/laundry/staff/:staffSequence/identity", verificationLimiter, documentUpload.single("document"), validateUploadedDocument(["image/jpeg", "image/png", "application/pdf"]), controller.uploadLaundryStaffIdentity);
router.patch("/staff/bookings/:bookingId/status", profileWriteLimiter, controller.updateStaffBookingStatus);
router.patch("/laundry/bookings/:bookingId/assign-staff", profileWriteLimiter, controller.assignLaundryStaff);
router.patch("/cleaning/bookings/:bookingId/assign-team", profileWriteLimiter, controller.assignCleaningTeam);
router.post("/verification", verificationLimiter, controller.submitVerification);
router.post("/profile-photo", verificationLimiter, imageUpload.single("photo"), validateUploadedImage(["image/jpeg", "image/png"]), rejectPlainSensitiveFields, controller.uploadProfilePhoto);
router.post("/documents", verificationLimiter, documentUpload.single("document"), validateUploadedDocument(["image/jpeg", "image/png", "application/pdf"]), rejectPlainSensitiveFields, controller.uploadDocument);
router.post("/support-tickets", profileWriteLimiter, controller.createSupportTicket);
router.post("/fcm-token", fcmTokenLimiter, controller.saveFcmToken);
router.post("/delete-account-request", profileWriteLimiter, controller.requestDeletion);
router.post("/online", profileWriteLimiter, controller.setOnline);
router.post("/offline", profileWriteLimiter, controller.setOnline);
router.patch("/location", locationUpdateLimiter, controller.updateLocation);
// Availability declaration — partner sets which slots they are free today/tomorrow
router.put("/availability", profileWriteLimiter, controller.setAvailability);
router.get("/statement", controller.statement);
router.get("/get-statement", controller.statement);

// Referral routes
router.get("/referrals", referralController.getMyReferrals);
router.post("/referrals/apply", profileWriteLimiter, referralController.applyReferralCode);

module.exports = router;
