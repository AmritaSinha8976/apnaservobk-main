const crypto = require("crypto");
const Partner = require("../models/Partner");
const Payment = require("../models/Payment");
const CommissionLedger = require("../models/CommissionLedger");
const cashfree = require("../config/cashfree");
const billingService = require("../services/billingService");
const { getSubscriptionAmount } = require("../utils/platformSettings");
const { ensureSubscriptionInvoice } = require("../services/invoiceService");

// ---------------------------------------------------------------------------
// Partner billing controller — NEW Cashfree subscription flow.
//
// Endpoints (mounted under /partners/billing):
//   GET  /status                 → billing snapshot the app renders
//   POST /cashfree/order         → create a Cashfree order for 299 subscription
//   POST /cashfree/verify        → client-initiated confirm (server verifies)
//   POST /cashfree/webhook       → Cashfree server-to-server confirmation
//
// The Razorpay booking-payment flow (paymentController.js) is untouched; this
// is a separate controller using the Cashfree PG API.
// ---------------------------------------------------------------------------

const SUBSCRIPTION_MONTH_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function referenceHash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

async function requirePartner(req, res) {
  const partner = await Partner.findOne({ firebaseUid: req.auth.uid });
  if (!partner) {
    res.status(404).json({ message: "Partner profile not found" });
    return null;
  }
  return partner;
}

// Commission earnings summary for cleaning partners.
async function commissionSummary(partnerId) {
  const rows = await CommissionLedger.aggregate([
    { $match: { partnerId } },
    {
      $group: {
        _id: null,
        jobs: { $sum: 1 },
        gross: { $sum: "$grossAmount" },
        commission: { $sum: "$commissionAmount" },
        netPayable: { $sum: "$netPayable" }
      }
    }
  ]);
  const row = rows[0] || {};
  return {
    jobs: row.jobs || 0,
    grossAmount: row.gross || 0,
    commissionAmount: row.commission || 0,
    netPayable: row.netPayable || 0
  };
}

async function status(req, res, next) {
  try {
    const partner = await requirePartner(req, res);
    if (!partner) return undefined;

    const snapshot = await billingService.buildBillingSnapshot(partner);
    const payload = { ...snapshot, billing: snapshot };

    if (snapshot.billingModel === "commission") {
      payload.commissionSummary = await commissionSummary(partner._id);
    }
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
}

async function createCashfreeOrder(req, res, next) {
  try {
    const partner = await requirePartner(req, res);
    if (!partner) return undefined;

    if (billingService.resolveBillingModel(partner) !== "subscription") {
      return res.status(409).json({ message: "Cleaning partners are billed by commission, not subscription" });
    }
    if (!cashfree.isConfigured()) {
      return res.status(503).json({ message: "Cashfree is not configured" });
    }

    const amount = await getSubscriptionAmount();
    if (!(amount > 0)) {
      return res.status(409).json({ message: "Subscription amount is not available" });
    }

    const orderId = `SUBPAY-${partner._id}-${Date.now()}`;
    const order = await cashfree.createOrder({
      orderId,
      amount,
      currency: "INR",
      customer: {
        id: String(partner._id),
        phone: partner.phone || "0000000000",
        name: partner.name || "ApnaServo Partner",
        email: partner.email || undefined
      },
      returnUrl: `${process.env.CLIENT_ORIGIN || ""}/partner-subscription-return?order_id={order_id}`,
      notifyUrl: `${(process.env.PUBLIC_API_BASE_URL || process.env.CLIENT_ORIGIN || "").replace(/\/$/, "")}/api/partners/billing/cashfree/webhook`,
      note: "ApnaServo partner monthly subscription"
    });

    await Payment.create({
      kind: "partner_subscription",
      partnerId: partner._id,
      serviceAmount: amount,
      amount,
      currency: "INR",
      status: "created",
      paymentMethod: "cashfree",
      cashfreeOrderId: order.order_id,
      cashfreeOrderIdHash: referenceHash(order.order_id)
    });

    return res.json({
      order: {
        orderId: order.order_id,
        amount: order.order_amount,
        currency: order.order_currency,
        paymentSessionId: order.payment_session_id
      },
      env: cashfree.environment()
    });
  } catch (error) {
    if (error.cashfree) {
      return res.status(error.status || 502).json({ message: error.message, details: error.cashfree });
    }
    return next(error);
  }
}

// Shared settlement logic: on a confirmed PAID Cashfree order, extend the
// subscription by one month and record the payment + invoice. Idempotent.
async function settlePaidSubscription(orderId) {
  const payment = await Payment.findOne({
    kind: "partner_subscription",
    cashfreeOrderIdHash: referenceHash(orderId)
  });
  if (!payment) {
    return { ok: false, reason: "payment_not_found" };
  }
  if (payment.status === "paid") {
    return { ok: true, alreadyPaid: true, payment };
  }

  // Server-side truth: fetch the order from Cashfree and confirm it is PAID.
  const order = await cashfree.fetchOrder(orderId);
  if (!order || order.order_status !== "PAID") {
    return { ok: false, reason: "order_not_paid", orderStatus: order?.order_status || "" };
  }

  const partner = await Partner.findById(payment.partnerId);
  if (!partner) {
    return { ok: false, reason: "partner_not_found" };
  }

  const now = new Date();
  // Extend from the later of now or the current (unexpired) expiry so paying
  // early stacks the month instead of losing remaining days.
  const currentExpiry = partner.subscriptionExpiresAt && new Date(partner.subscriptionExpiresAt) > now
    ? new Date(partner.subscriptionExpiresAt)
    : now;
  const periodStart = currentExpiry;
  const periodEnd = new Date(currentExpiry.getTime() + SUBSCRIPTION_MONTH_DAYS * DAY_MS);

  partner.subscriptionExpiresAt = periodEnd;
  partner.subscriptionStatus = "active";
  await partner.save();

  payment.status = "paid";
  payment.paidAt = now;
  payment.verifiedAt = now;
  payment.cashfreePaymentId = String(order.cf_order_id || order.order_id || "");
  payment.subscriptionPeriodStart = periodStart;
  payment.subscriptionPeriodEnd = periodEnd;
  await payment.save();

  try {
    await ensureSubscriptionInvoice({ partner, payment });
  } catch (invoiceError) {
    console.warn("[billing] subscription invoice failed", {
      paymentId: String(payment._id),
      message: invoiceError?.message
    });
  }

  return { ok: true, payment, partner };
}

async function verifyCashfreePayment(req, res, next) {
  try {
    const partner = await requirePartner(req, res);
    if (!partner) return undefined;

    const orderId = String(req.body?.orderId || req.body?.order_id || "").trim();
    if (!orderId) {
      return res.status(400).json({ message: "orderId is required" });
    }

    // Ownership check: the order must belong to this partner.
    const payment = await Payment.findOne({
      kind: "partner_subscription",
      cashfreeOrderIdHash: referenceHash(orderId)
    });
    if (!payment || String(payment.partnerId) !== String(partner._id)) {
      return res.status(404).json({ message: "Subscription order not found" });
    }

    const result = await settlePaidSubscription(orderId);
    if (!result.ok) {
      return res.status(409).json({ message: "Payment not confirmed yet", reason: result.reason });
    }

    const fresh = await Partner.findById(partner._id);
    const snapshot = await billingService.buildBillingSnapshot(fresh);
    return res.json({ ok: true, billing: snapshot });
  } catch (error) {
    return next(error);
  }
}

// Cashfree server-to-server webhook. Mounted with a raw body parser so the
// signature can be verified over the exact bytes Cashfree signed.
async function cashfreeWebhook(req, res) {
  try {
    const signature = req.headers["x-webhook-signature"];
    const timestamp = req.headers["x-webhook-timestamp"];
    const rawBody = req.rawBody || (Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "");

    if (!cashfree.verifyWebhookSignature(signature, rawBody, timestamp)) {
      return res.status(401).json({ message: "Invalid webhook signature" });
    }

    const event = JSON.parse(rawBody || "{}");
    const orderId = event?.data?.order?.order_id || event?.data?.order_id || "";
    if (orderId) {
      await settlePaidSubscription(orderId).catch((settleError) => {
        console.warn("[billing] webhook settle failed", { orderId, message: settleError?.message });
      });
    }
    // Always 200 so Cashfree does not retry indefinitely once we have accepted.
    return res.json({ ok: true });
  } catch (error) {
    console.warn("[billing] webhook error", { message: error?.message });
    return res.status(200).json({ ok: true });
  }
}

module.exports = {
  status,
  createCashfreeOrder,
  verifyCashfreePayment,
  cashfreeWebhook,
  settlePaidSubscription
};
