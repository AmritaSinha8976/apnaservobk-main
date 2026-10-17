const Partner = require("../models/Partner");
const Referral = require("../models/Referral");
const { statusForCount, maskReferredName, buildSummary, normalizeReferralCode } = require("../utils/referralHelpers");

// ─── Shared utility (also imported by bookingController) ──────────────────────

/**
 * Called after every booking completion.
 * Finds the active referral for the completing partner and increments their
 * completedJobCount by 1, but only up to ELIGIBILITY_THRESHOLD (idempotent).
 *
 * @param {mongoose.Types.ObjectId|string} completingPartnerId
 */
async function creditReferralJobOnce(completingPartnerId) {
  if (!completingPartnerId) return;

  const threshold = Referral.ELIGIBILITY_THRESHOLD; // 3

  // The $lt guard means this update becomes a no-op once the threshold is
  // reached, preventing double-counting regardless of retries.
  const updated = await Referral.findOneAndUpdate(
    {
      referredPartnerId: completingPartnerId,
      completedJobCount: { $lt: threshold }
    },
    [
      {
        $set: {
          completedJobCount: { $add: ["$completedJobCount", 1] },
          status: {
            $cond: {
              if: { $gte: [{ $add: ["$completedJobCount", 1] }, threshold] },
              then: "eligible",
              else: "in_progress"
            }
          }
        }
      }
    ],
    { new: true }
  );

  if (updated) {
    console.info("[referral] credited job", {
      referralId: String(updated._id),
      referredPartnerId: String(completingPartnerId),
      completedJobCount: updated.completedJobCount,
      status: updated.status
    });
  }
}

// ─── Route handlers ────────────────────────────────────────────────────────────

/**
 * POST /partners/referrals/apply
 * Body: { referralCode: string }
 *
 * Called during / after registration when the new partner supplies a referral
 * code.  Idempotent: a duplicate (referrerId, referredPartnerId) pair is
 * silently ignored (HTTP 200) so the client can safely retry.
 */
async function applyReferralCode(req, res, next) {
  try {
    const code = normalizeReferralCode(req.body?.referralCode);
    if (!code) {
      return res.status(400).json({ message: "referralCode is required" });
    }

    // Resolve the calling partner (the referred one).
    const referredPartner = await Partner.findOne({ firebaseUid: req.auth.uid }).select("_id partnerCode");
    if (!referredPartner) {
      return res.status(404).json({ message: "Partner profile not found" });
    }

    // Resolve the referrer by their partnerCode.
    const referrer = await Partner.findOne({ partnerCode: code }).select("_id partnerCode accountStatus");
    if (!referrer) {
      return res.status(404).json({ message: "Referral code not found" });
    }

    // A partner cannot refer themselves.
    if (String(referrer._id) === String(referredPartner._id)) {
      return res.status(400).json({ message: "You cannot use your own referral code" });
    }

    // Referrer must be an active partner.
    if (referrer.accountStatus && referrer.accountStatus !== "active") {
      return res.status(400).json({ message: "This referral code is no longer valid" });
    }

    // Create the referral; ignore duplicate-key errors (already applied).
    try {
      await Referral.create({
        referrerId: referrer._id,
        referredPartnerId: referredPartner._id,
        referralCode: code
      });
    } catch (err) {
      // E11000 duplicate key — already exists; treat as success.
      if (err.code !== 11000) throw err;
    }

    return res.json({ success: true, referralCode: code });
  } catch (error) {
    return next(error);
  }
}

/**
 * GET /partners/referrals
 *
 * Returns the authenticated partner's outbound referrals (partners they
 * referred) and a summary.
 */
async function getMyReferrals(req, res, next) {
  try {
    const partner = await Partner.findOne({ firebaseUid: req.auth.uid }).select("_id partnerCode");
    if (!partner) {
      return res.status(404).json({ message: "Partner profile not found" });
    }

    const referrals = await Referral.find({ referrerId: partner._id })
      .sort({ createdAt: -1 })
      .populate("referredPartnerId", "name serviceCategory")
      .lean();

    const threshold = Referral.ELIGIBILITY_THRESHOLD;

    const items = referrals.map((r) => {
      return {
        id: String(r._id),
        referredName: maskReferredName(r.referredPartnerId?.name),
        serviceCategory: r.referredPartnerId?.serviceCategory?.[0] || "",
        status: r.status,                   // "pending" | "in_progress" | "eligible"
        completedJobCount: r.completedJobCount,
        eligibilityThreshold: threshold,
        createdAt: r.createdAt
      };
    });

    const summary = buildSummary(items, partner.partnerCode);

    return res.json({ summary, referrals: items });
  } catch (error) {
    return next(error);
  }
}

module.exports = { applyReferralCode, getMyReferrals, creditReferralJobOnce };
