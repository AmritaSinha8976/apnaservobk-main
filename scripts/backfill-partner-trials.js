require("dotenv").config();
const mongoose = require("mongoose");
const Partner = require("../src/models/Partner");
const billingService = require("../src/services/billingService");
const { seedMonetizationDefaults, getFreeTrialDays } = require("../src/utils/platformSettings");

// ---------------------------------------------------------------------------
// Backfill partner monetization fields for existing partners.
//
//   • billingModel        → derived from serviceCategory (cleaning → commission)
//   • trialEndsAt         → createdAt + partner_free_trial_days (when missing)
//   • subscriptionStatus  → trial / active / expired, derived from the dates
//   • subscriptionExpiresAt is left as-is (defaults to null)
//
// Also seeds the three PlatformSetting defaults (299 / 0.25 / 10) if absent.
//
// Dry-run by default. Pass --apply to persist changes.
//   node scripts/backfill-partner-trials.js            # report only
//   node scripts/backfill-partner-trials.js --apply    # write changes
// ---------------------------------------------------------------------------

const apply = process.argv.includes("--apply");
const DAY_MS = 24 * 60 * 60 * 1000;

async function run() {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is required");
  }
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`[backfill] connected (${apply ? "APPLY" : "DRY-RUN"})`);

  const seeded = await seedMonetizationDefaults();
  console.log("[backfill] monetization defaults ensured:", seeded);

  const freeTrialDays = await getFreeTrialDays();
  const now = new Date();

  const partners = await Partner.find(
    {},
    { serviceCategory: 1, createdAt: 1, billingModel: 1, subscriptionStatus: 1, subscriptionExpiresAt: 1, trialEndsAt: 1 }
  );

  let updated = 0;
  const summary = { commission: 0, subscription: 0, trial: 0, active: 0, expired: 0 };

  for (const partner of partners) {
    const update = {};

    const model = billingService.resolveBillingModel(partner);
    if (partner.billingModel !== model) update.billingModel = model;
    summary[model] += 1;

    if (!partner.trialEndsAt) {
      const base = partner.createdAt ? new Date(partner.createdAt) : now;
      update.trialEndsAt = new Date(base.getTime() + freeTrialDays * DAY_MS);
    }

    // Derive status from the (possibly just-computed) trial/expiry dates.
    const effective = {
      trialEndsAt: update.trialEndsAt || partner.trialEndsAt,
      subscriptionExpiresAt: partner.subscriptionExpiresAt
    };
    const status = billingService.resolveSubscriptionStatus(effective, now);
    if (partner.subscriptionStatus !== status) update.subscriptionStatus = status;
    summary[status] += 1;

    if (Object.keys(update).length) {
      updated += 1;
      if (apply) {
        await Partner.updateOne({ _id: partner._id }, { $set: update });
      }
    }
  }

  console.log("[backfill] partners scanned:", partners.length);
  console.log("[backfill] partners needing update:", updated);
  console.log("[backfill] model/status distribution:", summary);
  console.log(`[backfill] ${apply ? "changes applied" : "dry-run only — re-run with --apply to persist"}`);

  await mongoose.disconnect();
}

run().catch((error) => {
  console.error("[backfill] failed:", error);
  process.exitCode = 1;
  mongoose.disconnect().catch(() => {});
});
