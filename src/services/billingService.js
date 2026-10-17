const { normalizeServiceCategory } = require("../utils/serviceCategory");
const {
  getSubscriptionAmount,
  getCleaningCommissionRate,
  getFreeTrialDays
} = require("../utils/platformSettings");

// ---------------------------------------------------------------------------
// Partner billing service.
//
// Single source of truth for the two monetization tracks:
//   • commission  → cleaning partners. No subscription; the platform takes
//                   cleaning_commission_rate (0.25) per completed job, and 0%
//                   while inside the free trial.
//   • subscription→ everyone else. Flat partner_subscription_amount (299) per
//                   month to keep receiving bookings; dispatch is gated when
//                   the subscription is expired and the trial is over.
//
// A partner is "cleaning" when their normalized serviceCategory list includes
// "cleaning". Mixed-category partners (cleaning + something else) are treated
// as commission — the no-subscription track — per the product decision.
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

function partnerCategories(partner) {
  return (partner?.serviceCategory || [])
    .map(normalizeServiceCategory)
    .filter((category) => category && category !== "service");
}

// True when the partner offers cleaning (commission model), regardless of any
// other services they also provide.
function isCleaningPartner(partner) {
  return partnerCategories(partner).includes("cleaning");
}

function resolveBillingModel(partner) {
  return isCleaningPartner(partner) ? "commission" : "subscription";
}

function trialEndDate(partner) {
  if (partner?.trialEndsAt) return new Date(partner.trialEndsAt);
  return null;
}

// Days left in the free launch window (0 once it has ended). Rounded up so a
// partner mid-way through their last day still sees "1 day left".
function trialDaysRemaining(partner, now = new Date()) {
  const end = trialEndDate(partner);
  if (!end) return 0;
  const diff = end.getTime() - now.getTime();
  if (diff <= 0) return 0;
  return Math.ceil(diff / DAY_MS);
}

function isWithinTrial(partner, now = new Date()) {
  const end = trialEndDate(partner);
  return Boolean(end) && end.getTime() > now.getTime();
}

function isSubscriptionActive(partner, now = new Date()) {
  const expiry = partner?.subscriptionExpiresAt ? new Date(partner.subscriptionExpiresAt) : null;
  return Boolean(expiry) && expiry.getTime() > now.getTime();
}

// Core gate used by booking dispatch.
//   • cleaning partners are ALWAYS active (never gated by subscription)
//   • subscription partners are active while inside the trial OR while their
//     subscription has not expired
function isPartnerBillingActive(partner, now = new Date()) {
  if (resolveBillingModel(partner) === "commission") return true;
  if (isWithinTrial(partner, now)) return true;
  return isSubscriptionActive(partner, now);
}

// Derives the subscriptionStatus label for display/storage. Cleaning partners
// are not subscription-gated, but we still report trial vs active so the app
// can show the "free for N days" launch message.
function resolveSubscriptionStatus(partner, now = new Date()) {
  if (isWithinTrial(partner, now)) return "trial";
  if (isSubscriptionActive(partner, now)) return "active";
  return "expired";
}

// Effective commission rate for a cleaning booking completion.
// 0% while inside the free trial, otherwise cleaning_commission_rate.
async function commissionRateForPartner(partner, now = new Date()) {
  if (resolveBillingModel(partner) !== "commission") return 0;
  if (isWithinTrial(partner, now)) return 0;
  return getCleaningCommissionRate();
}

// Builds the trial window end date for a freshly created partner.
async function computeTrialEndsAt(createdAt = new Date()) {
  const days = await getFreeTrialDays();
  return new Date(new Date(createdAt).getTime() + days * DAY_MS);
}

// Produces the initial monetization fields for a brand-new partner profile.
async function initialBillingFields(partner, createdAt = new Date()) {
  const trialEndsAt = await computeTrialEndsAt(createdAt);
  return {
    billingModel: resolveBillingModel(partner),
    subscriptionStatus: "trial",
    subscriptionExpiresAt: null,
    trialEndsAt
  };
}

// Rich snapshot consumed by GET /partners/billing/status and the admin panel.
async function buildBillingSnapshot(partner, now = new Date()) {
  const model = resolveBillingModel(partner);
  const status = resolveSubscriptionStatus(partner, now);
  const withinTrial = isWithinTrial(partner, now);
  const trialDaysLeft = trialDaysRemaining(partner, now);
  const [subscriptionAmount, cleaningRate, trialDays] = await Promise.all([
    getSubscriptionAmount(),
    getCleaningCommissionRate(),
    getFreeTrialDays()
  ]);
  const active = isPartnerBillingActive(partner, now);

  return {
    // Fields the Partner app's billing card reads. "kind" mirrors the app's
    // existing optString("kind", "subscription") contract.
    kind: model,
    billingModel: model,
    subscriptionStatus: status,
    active,
    withinTrial,
    trialDaysRemaining: trialDaysLeft,
    trialEndsAt: partner?.trialEndsAt ? new Date(partner.trialEndsAt).toISOString() : null,
    subscriptionExpiresAt: partner?.subscriptionExpiresAt
      ? new Date(partner.subscriptionExpiresAt).toISOString()
      : null,
    freeTrialDays: trialDays,
    // Next amount due for subscription partners. 0 while active or in trial.
    amount: model === "subscription" && !active ? subscriptionAmount : 0,
    subscriptionAmount,
    cleaningCommissionRate: cleaningRate,
    cleaningCommissionPercent: Math.round(cleaningRate * 100)
  };
}

module.exports = {
  isCleaningPartner,
  resolveBillingModel,
  trialDaysRemaining,
  isWithinTrial,
  isSubscriptionActive,
  isPartnerBillingActive,
  resolveSubscriptionStatus,
  commissionRateForPartner,
  computeTrialEndsAt,
  initialBillingFields,
  buildBillingSnapshot
};
