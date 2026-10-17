/**
 * Regression test for PATCH /bookings/:bookingId/status  →  updateStatus()
 *
 * This drives the REAL controller (src/controllers/bookingController.js) against
 * an in-memory MongoDB, reproducing the exact flow from the partner-app
 * screenshots: a verified partner on an accepted "Home Cleaning" booking taps
 * "Mark as On The Way".
 *
 * Unlike a lifecycle-helper unit test, this exercises the full handler path:
 * actor resolution → booking lookup → expireQuoteIfNeeded → transitionDecision →
 * optional GPS/LocationLog write → Booking.findOneAndUpdate($push) → notify/socket.
 *
 * Run: node scripts/update-status-controller.test.js
 */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

let mem, User, Partner, Booking, controller;

before(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: "booking_status_test" });
  User = require("../src/models/User");
  Partner = require("../src/models/Partner");
  ({ Booking } = require("../src/models/Booking"));
  controller = require("../src/controllers/bookingController");
});

after(async () => {
  await mongoose.disconnect();
  await mem.stop();
});

const rand = () => Math.random().toString(36).slice(2, 10);

async function seed({ partnerOverrides = {}, userOverrides = {}, bookingOverrides = {}, mutate } = {}) {
  const partner = await Partner.create({
    firebaseUid: "p-" + rand(), name: "amrita", phone: "+919000007914",
    serviceCategory: ["cleaning"], accountStatus: "active", trustStatus: "trusted",
    kycStatus: "verified", isVerified: true, isOnline: true, ...partnerOverrides
  });
  const user = await User.create({
    firebaseUid: "u-" + rand(), name: "Customer", phone: "+919000000001", ...userOverrides
  });
  const booking = await Booking.create({
    bookingCode: "ASB-" + rand().toUpperCase(), userId: user._id, partnerId: partner._id,
    serviceCategory: "cleaning", serviceName: "Home Cleaning", issue: "Home Cleaning",
    address: "223, Jalukbari, Guwahati 781011", city: "Guwahati", status: "accepted",
    acceptedAt: new Date(), userSnapshot: { name: "Customer", phone: "+919000000001" },
    partnerSnapshot: { name: "amrita", phone: "+919000007914" }, ...bookingOverrides
  });
  if (mutate) await Booking.collection.updateOne({ _id: booking._id }, mutate);
  return { partner, user, booking };
}

// Invoke the controller with a fake req/res/next and resolve with the outcome.
function invoke(fn, { auth, params, body }) {
  return new Promise((resolve) => {
    let statusCode = 200;
    const res = {
      status(c) { statusCode = c; return this; },
      json(o) { resolve({ statusCode, body: o, error: null }); return this; }
    };
    const next = (err) => resolve({ statusCode: err?.status || err?.statusCode || 500, body: null, error: err });
    Promise.resolve(fn({ auth, params, body }, res, next)).catch((err) =>
      resolve({ statusCode: 500, body: null, error: err }));
  });
}

// Exact payload the partner app's "Mark as On The Way" button sends (no GPS).
const BUTTON_BODY = { status: "on_the_way", finalAmount: 0, additionalWork: "", partnerNotes: "" };

test("accepted → on_the_way with the exact app button payload returns 200 (not 500)", async () => {
  const { partner, booking } = await seed();
  const out = await invoke(controller.updateStatus, {
    auth: { uid: partner.firebaseUid }, params: { bookingId: String(booking._id) }, body: BUTTON_BODY
  });
  assert.equal(out.error, null, out.error && out.error.stack);
  assert.equal(out.statusCode, 200);
  assert.equal(out.body.booking.status, "on_the_way");
  assert.ok(!out.body.idempotent, "first advance must be a real write, not idempotent");
  const persisted = await Booking.findById(booking._id).lean();
  assert.equal(persisted.status, "on_the_way");
});

test("accepted → on_the_way with a valid GPS payload returns 200", async () => {
  const { partner, booking } = await seed();
  const out = await invoke(controller.updateStatus, {
    auth: { uid: partner.firebaseUid }, params: { bookingId: String(booking._id) },
    body: { status: "on_the_way", finalAmount: 0, lat: 26.1445, lng: 91.7362, accuracy: 15, provider: "fused", isMock: false, recordedAt: Date.now() }
  });
  assert.equal(out.error, null, out.error && out.error.stack);
  assert.equal(out.statusCode, 200);
  assert.equal(out.body.booking.status, "on_the_way");
});

test("legacy booking with statusTimeline/quoteHistory UNSET still returns 200", async () => {
  const { partner, booking } = await seed({ mutate: { $unset: { statusTimeline: "", quoteHistory: "" } } });
  const out = await invoke(controller.updateStatus, {
    auth: { uid: partner.firebaseUid }, params: { bookingId: String(booking._id) }, body: BUTTON_BODY
  });
  assert.equal(out.error, null, out.error && out.error.stack);
  assert.equal(out.statusCode, 200);
  assert.equal(out.body.booking.status, "on_the_way");
});

test("repeating on_the_way after it is applied is idempotent 200, not 500", async () => {
  const { partner, booking } = await seed();
  const first = await invoke(controller.updateStatus, {
    auth: { uid: partner.firebaseUid }, params: { bookingId: String(booking._id) }, body: BUTTON_BODY
  });
  assert.equal(first.statusCode, 200);
  const second = await invoke(controller.updateStatus, {
    auth: { uid: partner.firebaseUid }, params: { bookingId: String(booking._id) }, body: BUTTON_BODY
  });
  assert.equal(second.error, null, second.error && second.error.stack);
  assert.equal(second.statusCode, 200);
  assert.equal(second.body.idempotent, true);
});

test("unknown partner firebaseUid cannot update → 403 (never 500)", async () => {
  const { booking } = await seed();
  const out = await invoke(controller.updateStatus, {
    auth: { uid: "p-does-not-exist" }, params: { bookingId: String(booking._id) }, body: BUTTON_BODY
  });
  assert.equal(out.error, null);
  assert.equal(out.statusCode, 403);
});
