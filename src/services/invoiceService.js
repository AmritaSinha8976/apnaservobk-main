const Invoice = require("../models/Invoice");

function amount(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 100) / 100) : 0;
}

async function ensurePaidInvoice({ booking, payment, user, partner }) {
  if (!booking || !payment || payment.status !== "paid") return null;
  const finalAmount = amount(payment.amount);
  const data = {
    bookingId: booking._id,
    paymentId: payment._id,
    userId: booking.userId,
    partnerId: booking.partnerId || null,
    serviceDescription: booking.serviceName || booking.serviceCategory || "ApnaServo service",
    serviceAmount: amount(payment.serviceAmount || finalAmount),
    additionalCharges: amount(payment.additionalCharges),
    discount: amount(payment.discount),
    tax: amount(payment.tax),
    finalAmount,
    currency: payment.currency || "INR",
    paymentStatus: "paid",
    paymentMethod: payment.paymentMethod || "razorpay",
    transactionId: payment.razorpayPaymentId || "",
    paidAt: payment.paidAt || payment.verifiedAt || new Date(),
    customerName: user?.name || booking.userSnapshot?.name || "Customer",
    customerPhone: user?.phone || booking.userSnapshot?.phone || "",
    serviceAddress: booking.address || "",
    partnerName: partner?.name || booking.partnerSnapshot?.name || "Service Partner",
    bookingCode: booking.bookingCode || ""
  };
  let invoice;
  try {
    invoice = await Invoice.findOneAndUpdate(
      { bookingId: booking._id },
      { $setOnInsert: data },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    if (error?.code !== 11000) throw error;
    invoice = await Invoice.findOne({ bookingId: booking._id });
    if (!invoice) throw error;
  }
  if (!payment.invoiceId) {
    payment.invoiceId = invoice._id;
    await payment.save();
  }
  return invoice;
}

// Invoice for a paid partner subscription (NEW Cashfree flow). Keyed on the
// payment so it is idempotent across webhook + client-verify double delivery.
async function ensureSubscriptionInvoice({ partner, payment }) {
  if (!partner || !payment || payment.status !== "paid") return null;
  const finalAmount = amount(payment.amount);
  const periodEnd = payment.subscriptionPeriodEnd
    ? new Date(payment.subscriptionPeriodEnd).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })
    : "";
  const data = {
    kind: "partner_subscription",
    paymentId: payment._id,
    partnerId: partner._id,
    serviceDescription: `ApnaServo partner subscription${periodEnd ? ` (valid until ${periodEnd})` : ""}`,
    serviceAmount: finalAmount,
    finalAmount,
    currency: payment.currency || "INR",
    paymentStatus: "paid",
    paymentMethod: payment.paymentMethod || "cashfree",
    transactionId: payment.cashfreePaymentId || payment.cashfreeOrderId || "",
    paidAt: payment.paidAt || payment.verifiedAt || new Date(),
    partnerName: partner.name || "Service Partner"
  };
  let invoice;
  try {
    invoice = await Invoice.findOneAndUpdate(
      { paymentId: payment._id },
      { $setOnInsert: data },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    if (error?.code !== 11000) throw error;
    invoice = await Invoice.findOne({ paymentId: payment._id });
    if (!invoice) throw error;
  }
  if (!payment.invoiceId) {
    payment.invoiceId = invoice._id;
    await payment.save();
  }
  return invoice;
}

module.exports = { ensurePaidInvoice, ensureSubscriptionInvoice };
