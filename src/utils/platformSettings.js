const PlatformSetting = require("../models/PlatformSetting");

// ---------------------------------------------------------------------------
// Partner monetization configuration.
//
// The three business numbers — monthly subscription fee, cleaning commission
// rate and free-trial length — must be editable at runtime without a code
// change, so they live in the PlatformSetting key/value store.  This helper
// reads them with a small in-process cache and a safe fallback chain:
//
//   PlatformSetting (admin-editable)  →  environment variable  →  spec default
//
// Keys and defaults match the spec: 299 / 0.25 / 10.
// ---------------------------------------------------------------------------

const KEYS = {
  subscriptionAmount: "partner_subscription_amount",
  cleaningCommissionRate: "cleaning_commission_rate",
  freeTrialDays: "partner_free_trial_days"
};

const DEFAULTS = {
  [KEYS.subscriptionAmount]: 299,
  [KEYS.cleaningCommissionRate]: 0.25,
  [KEYS.freeTrialDays]: 10
};

const ENV_FALLBACK = {
  [KEYS.subscriptionAmount]: "PARTNER_SUBSCRIPTION_AMOUNT",
  [KEYS.cleaningCommissionRate]: "CLEANING_COMMISSION_RATE",
  [KEYS.freeTrialDays]: "PARTNER_FREE_TRIAL_DAYS"
};

const CACHE_TTL_MS = 60 * 1000;
const cache = new Map(); // key -> { value, expiresAt }

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fallbackValue(key) {
  const envName = ENV_FALLBACK[key];
  const envValue = envName ? toNumber(process.env[envName]) : null;
  if (envValue !== null) return envValue;
  return DEFAULTS[key];
}

async function readSetting(key) {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  let value = fallbackValue(key);
  try {
    const doc = await PlatformSetting.findOne({ key }).lean();
    const stored = doc ? toNumber(doc.value) : null;
    if (stored !== null) value = stored;
  } catch (error) {
    // On a read failure keep the env/default fallback — monetization config
    // must never block booking dispatch.
    console.warn("[platformSettings] read failed", { key, message: error?.message });
  }
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

function invalidateCache(key) {
  if (key) cache.delete(key);
  else cache.clear();
}

async function getSubscriptionAmount() {
  const value = await readSetting(KEYS.subscriptionAmount);
  return value > 0 ? value : DEFAULTS[KEYS.subscriptionAmount];
}

async function getCleaningCommissionRate() {
  const value = await readSetting(KEYS.cleaningCommissionRate);
  return value >= 0 && value <= 1 ? value : DEFAULTS[KEYS.cleaningCommissionRate];
}

async function getFreeTrialDays() {
  const value = await readSetting(KEYS.freeTrialDays);
  return value >= 0 ? Math.round(value) : DEFAULTS[KEYS.freeTrialDays];
}

async function getMonetizationConfig() {
  const [subscriptionAmount, cleaningCommissionRate, freeTrialDays] = await Promise.all([
    getSubscriptionAmount(),
    getCleaningCommissionRate(),
    getFreeTrialDays()
  ]);
  return { subscriptionAmount, cleaningCommissionRate, freeTrialDays };
}

// Upserts a single monetization setting (used by the admin controller) and
// invalidates the cache so the new value is visible immediately.
async function setMonetizationSetting(key, rawValue, updatedBy) {
  if (!Object.values(KEYS).includes(key)) {
    const error = new Error("Unknown monetization setting key");
    error.status = 400;
    throw error;
  }
  const value = toNumber(rawValue);
  if (value === null) {
    const error = new Error(`${key} must be a number`);
    error.status = 400;
    throw error;
  }
  if (key === KEYS.cleaningCommissionRate && (value < 0 || value > 1)) {
    const error = new Error("cleaning_commission_rate must be between 0 and 1");
    error.status = 400;
    throw error;
  }
  if ((key === KEYS.subscriptionAmount || key === KEYS.freeTrialDays) && value < 0) {
    const error = new Error(`${key} must be zero or greater`);
    error.status = 400;
    throw error;
  }
  await PlatformSetting.findOneAndUpdate(
    { key },
    { $set: { value, updatedBy: updatedBy || "admin" } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  invalidateCache(key);
  return value;
}

// Ensures the three keys exist with their default values. Safe to call on
// startup — existing admin-set values are never overwritten.
async function seedMonetizationDefaults() {
  const results = {};
  for (const [key, value] of Object.entries(DEFAULTS)) {
    const doc = await PlatformSetting.findOneAndUpdate(
      { key },
      { $setOnInsert: { value, updatedBy: "system" } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
    results[key] = doc?.value;
  }
  invalidateCache();
  return results;
}

module.exports = {
  KEYS,
  DEFAULTS,
  getSubscriptionAmount,
  getCleaningCommissionRate,
  getFreeTrialDays,
  getMonetizationConfig,
  setMonetizationSetting,
  seedMonetizationDefaults,
  invalidateCache
};
