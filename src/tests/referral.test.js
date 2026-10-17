/**
 * Unit tests for referral feature pure helpers.
 * Run with:  node --test src/tests/referral.test.js
 * Requires Node >= 18 (built-in node:test runner, no extra deps).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  statusForCount,
  maskReferredName,
  buildSummary,
  normalizeReferralCode,
  ELIGIBILITY_THRESHOLD
} = require("../utils/referralHelpers");

// ─── statusForCount ───────────────────────────────────────────────────────────

describe("statusForCount", () => {
  it("returns pending for 0 jobs", () => {
    assert.equal(statusForCount(0), "pending");
  });

  it("returns in_progress for 1 job", () => {
    assert.equal(statusForCount(1), "in_progress");
  });

  it("returns in_progress for 2 jobs", () => {
    assert.equal(statusForCount(2), "in_progress");
  });

  it("returns eligible at the threshold (3)", () => {
    assert.equal(statusForCount(ELIGIBILITY_THRESHOLD), "eligible");
  });

  it("returns eligible for counts above the threshold", () => {
    assert.equal(statusForCount(10), "eligible");
  });

  it("ELIGIBILITY_THRESHOLD is 3", () => {
    assert.equal(ELIGIBILITY_THRESHOLD, 3);
  });
});

// ─── maskReferredName ─────────────────────────────────────────────────────────

describe("maskReferredName", () => {
  it("masks a long first name keeping first letter + up to 3 asterisks", () => {
    assert.equal(maskReferredName("Rajesh Kumar"), "R***");
  });

  it("masks a 2-character first name", () => {
    assert.equal(maskReferredName("Al Smith"), "A*");
  });

  it("returns a single-character first name as-is", () => {
    assert.equal(maskReferredName("J"), "J");
  });

  it("caps asterisks at 3 even for very long names", () => {
    assert.equal(maskReferredName("Thiruvananthapuram"), "T***");
  });

  it("handles null/undefined gracefully with fallback", () => {
    assert.equal(maskReferredName(null), "P***");    // "Partner" → "P***"
    assert.equal(maskReferredName(undefined), "P***");
    assert.equal(maskReferredName(""), "P***");
  });

  it("handles a name with only a first name (no space)", () => {
    assert.equal(maskReferredName("Amir"), "A***");
  });
});

// ─── buildSummary ─────────────────────────────────────────────────────────────

describe("buildSummary", () => {
  const items = [
    { status: "pending" },
    { status: "in_progress" },
    { status: "in_progress" },
    { status: "eligible" }
  ];

  it("counts total correctly", () => {
    assert.equal(buildSummary(items, "ASP123").total, 4);
  });

  it("counts pending correctly", () => {
    assert.equal(buildSummary(items, "ASP123").pending, 1);
  });

  it("counts inProgress correctly", () => {
    assert.equal(buildSummary(items, "ASP123").inProgress, 2);
  });

  it("counts eligible correctly", () => {
    assert.equal(buildSummary(items, "ASP123").eligible, 1);
  });

  it("includes referralCode in summary", () => {
    assert.equal(buildSummary(items, "ASP123ABC").referralCode, "ASP123ABC");
  });

  it("includes eligibilityThreshold in summary", () => {
    assert.equal(buildSummary(items, "X").eligibilityThreshold, ELIGIBILITY_THRESHOLD);
  });

  it("returns zeros for an empty list", () => {
    const s = buildSummary([], "CODE");
    assert.equal(s.total, 0);
    assert.equal(s.pending, 0);
    assert.equal(s.inProgress, 0);
    assert.equal(s.eligible, 0);
  });
});

// ─── normalizeReferralCode ────────────────────────────────────────────────────

describe("normalizeReferralCode", () => {
  it("trims and uppercases a valid code", () => {
    assert.equal(normalizeReferralCode("  asp123abc  "), "ASP123ABC");
  });

  it("returns null for empty string", () => {
    assert.equal(normalizeReferralCode(""), null);
  });

  it("returns null for a string that is only whitespace", () => {
    assert.equal(normalizeReferralCode("   "), null);
  });

  it("returns null for non-string inputs", () => {
    assert.equal(normalizeReferralCode(null), null);
    assert.equal(normalizeReferralCode(undefined), null);
    assert.equal(normalizeReferralCode(42), null);
  });

  it("returns null for a code exceeding 30 characters", () => {
    assert.equal(normalizeReferralCode("A".repeat(31)), null);
  });

  it("accepts a code of exactly 30 characters", () => {
    const code = "A".repeat(30);
    assert.equal(normalizeReferralCode(code), code);
  });
});
