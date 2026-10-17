const mongoose = require("mongoose");
const encryptedFieldsPlugin = require("../utils/encryptedFieldsPlugin");
const { publicIdPlugin } = require("../utils/publicIds");

const invoiceSchema = new mongoose.Schema({
  // "kind" distinguishes a booking invoice (default) from a partner
  // subscription invoice (new Cashfree flow). Subscription invoices have no
  // bookingId/userId, so those are only required for booking invoices.
  kind: { type: String, enum: ["booking", "partner_subscription"], default: "booking", index: true },
  bookingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Booking",
    required: function requiredForBooking() { return this.kind !== "partner_subscription"; }
  },
  paymentId: { type: mongoose.Schema.Types.ObjectId, ref: "Payment", required: true, unique: true, index: true },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    index: true,
    required: function requiredForBooking() { return this.kind !== "partner_subscription"; }
  },
  partnerId: { type: mongoose.Schema.Types.ObjectId, ref: "Partner", default: null, index: true },
  serviceDescription: { type: String, required: true, trim: true },
  serviceAmount: { type: Number, min: 0, default: 0 },
  additionalCharges: { type: Number, min: 0, default: 0 },
  discount: { type: Number, min: 0, default: 0 },
  tax: { type: Number, min: 0, default: 0 },
  finalAmount: { type: Number, min: 0, required: true },
  currency: { type: String, default: "INR" },
  paymentStatus: { type: String, enum: ["paid", "refunded"], required: true },
  paymentMethod: { type: String, default: "", trim: true },
  transactionId: { type: String, default: "", trim: true },
  paidAt: { type: Date, default: null },
  customerName: { type: String, default: "", trim: true },
  customerPhone: { type: String, default: "", trim: true },
  serviceAddress: { type: String, default: "", trim: true },
  partnerName: { type: String, default: "", trim: true },
  bookingCode: { type: String, default: "", trim: true, index: true }
}, { timestamps: true });

// Booking invoices remain one-per-booking; subscription invoices (null
// bookingId) are excluded from the uniqueness constraint via a partial index.
invoiceSchema.index(
  { bookingId: 1 },
  { unique: true, partialFilterExpression: { bookingId: { $type: "objectId" } } }
);
invoiceSchema.index({ kind: 1, partnerId: 1, createdAt: -1 });

invoiceSchema.plugin(publicIdPlugin, { kind: "invoice", field: "invoiceNumber" });
invoiceSchema.plugin(encryptedFieldsPlugin, {
  fields: ["customerName", "customerPhone", "serviceAddress", "partnerName", "transactionId"]
});

module.exports = mongoose.model("Invoice", invoiceSchema);
