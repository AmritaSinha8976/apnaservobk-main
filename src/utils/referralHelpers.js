/**
 * Pure helper functions extracted from referralController so they can be
 * unit-tested without a database connection.
 */

const ELIGIBILITY_THRESHOLD = 3;

/**
 * Given a completedJobCount and the threshold, return the correct status string.
 * This mirrors the $cond pipeline expression in creditReferralJobOnce.
 *
 * @param {number} count
 * @returns {"pending"|"in_progress"|"eligible"}
 */
function statusForCount(count) {
  if (count <= 0) return "pending";
  if (count >= ELIGIBILITY_THRESHOLD) return "eligible";
  return "in_progress";
}

/**
 * Mask a partner's full name for privacy: keep first letter, replace up to 3
 * subsequent characters with asterisks.
 *
 * @param {string} fullName
 * @returns {string}
 */
function maskReferredName(fullName) {
  const name = typeof fullName === "string" && fullName.trim() ? fullName.trim() : "Partner";
  const firstName = name.split(" ")[0];
  if (firstName.length <= 1) return firstName;
  return firstName[0] + "*".repeat(Math.min(firstName.length - 1, 3));
}

/**
 * Build a summary object from an array of referral item objects that each
 * carry a `status` field.
 *
 * @param {Array<{status: string}>} items
 * @param {string} referralCode
 * @returns {object}
 */
function buildSummary(items, referralCode) {
  return {
    total: items.length,
    pending: items.filter((r) => r.status === "pending").length,
    inProgress: items.filter((r) => r.status === "in_progress").length,
    eligible: items.filter((r) => r.status === "eligible").length,
    referralCode: referralCode || "",
    eligibilityThreshold: ELIGIBILITY_THRESHOLD
  };
}

/**
 * Validate a raw referral-code string from a request body.
 * Returns the normalised (trimmed, uppercased) code, or null if invalid.
 *
 * @param {unknown} raw
 * @returns {string|null}
 */
function normalizeReferralCode(raw) {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return code.length > 0 && code.length <= 30 ? code : null;
}

module.exports = { statusForCount, maskReferredName, buildSummary, normalizeReferralCode, ELIGIBILITY_THRESHOLD };
