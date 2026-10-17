const crypto = require("crypto");

// ---------------------------------------------------------------------------
// Cashfree Payment Gateway client for the NEW partner-subscription flow.
//
// This is deliberately a thin wrapper over Cashfree's PG REST API (version
// 2023-08-01) using Node's global fetch, rather than the version-coupled SDK.
// It is completely independent of the existing Razorpay booking-payment code.
//
// Credentials come from the environment:
//   CASHFREE_APP_ID      → x-client-id
//   CASHFREE_SECRET_KEY  → x-client-secret
//   CASHFREE_ENV         → SANDBOX (default) | PRODUCTION
// ---------------------------------------------------------------------------

const API_VERSION = "2023-08-01";

function environment() {
  return String(process.env.CASHFREE_ENV || "SANDBOX").trim().toUpperCase() === "PRODUCTION"
    ? "PRODUCTION"
    : "SANDBOX";
}

function baseUrl() {
  return environment() === "PRODUCTION"
    ? "https://api.cashfree.com/pg"
    : "https://sandbox.cashfree.com/pg";
}

function isConfigured() {
  return Boolean(process.env.CASHFREE_APP_ID && process.env.CASHFREE_SECRET_KEY);
}

function authHeaders() {
  return {
    "x-client-id": process.env.CASHFREE_APP_ID || "",
    "x-client-secret": process.env.CASHFREE_SECRET_KEY || "",
    "x-api-version": API_VERSION,
    "Content-Type": "application/json"
  };
}

async function request(method, path, body) {
  const response = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: authHeaders(),
    body: body ? JSON.stringify(body) : undefined
  });
  let data = null;
  try {
    data = await response.json();
  } catch (parseError) {
    data = null;
  }
  if (!response.ok) {
    const error = new Error(data?.message || `Cashfree request failed (${response.status})`);
    error.status = response.status;
    error.cashfree = data;
    throw error;
  }
  return data;
}

// Creates a Cashfree order and returns the raw order (including
// payment_session_id, used by the app to launch hosted checkout).
async function createOrder({ orderId, amount, currency = "INR", customer, returnUrl, notifyUrl, note }) {
  const payload = {
    order_id: orderId,
    order_amount: Number(amount),
    order_currency: currency,
    customer_details: {
      customer_id: customer.id,
      customer_phone: customer.phone || "0000000000",
      customer_name: customer.name || "ApnaServo Partner",
      customer_email: customer.email || undefined
    },
    order_meta: {
      return_url: returnUrl || undefined,
      notify_url: notifyUrl || undefined
    },
    order_note: note || "ApnaServo partner subscription"
  };
  return request("POST", "/orders", payload);
}

// Fetches an order so the backend can confirm PAID status server-side
// (never trust the client).
async function fetchOrder(orderId) {
  return request("GET", `/orders/${encodeURIComponent(orderId)}`, null);
}

// Verifies a Cashfree webhook signature.
// Signature = base64(HMAC-SHA256(timestamp + rawBody, secretKey)).
function verifyWebhookSignature(signature, rawBody, timestamp) {
  if (!signature || !rawBody || !timestamp) return false;
  const payload = `${timestamp}${rawBody}`;
  const expected = crypto
    .createHmac("sha256", process.env.CASHFREE_SECRET_KEY || "")
    .update(payload)
    .digest("base64");
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(String(signature));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (error) {
    return false;
  }
}

module.exports = {
  API_VERSION,
  environment,
  isConfigured,
  createOrder,
  fetchOrder,
  verifyWebhookSignature
};
