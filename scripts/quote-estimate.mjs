// Deterministic quote estimator for glass panels.
//
// ACCEPTANCE CONTRACT v1. All monetary values are rounded half-up to two
// decimals at the moment they are computed, and totals are built from the
// already-rounded parts.

export class QuoteError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "QuoteError";
    this.code = code;
  }
}

const GLASS_RATES = { basic: 120, tempered: 210, laminated: 280 };
const EDGE_RATES = { none: 0, polished: 45, beveled: 90 };
const VAT_RATE = 0.23;
const SHIPPING = 49;
const FREE_SHIPPING_THRESHOLD = 2000;
const MIN_ORDER = 150;
const SAVE10_CAP = 200;
const SAVE10_RATE = 0.1;

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizeKey(value) {
  return typeof value === "string" ? value.toLowerCase() : null;
}

function validateArea(areaM2) {
  if (typeof areaM2 !== "number" || !Number.isFinite(areaM2) || areaM2 <= 0 || areaM2 > 1000) {
    throw new QuoteError("INVALID_AREA", "areaM2 must be a finite number greater than 0 and at most 1000");
  }
}

function validateQuantity(quantity) {
  if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > 500) {
    throw new QuoteError("INVALID_QUANTITY", "quantity must be an integer between 1 and 500");
  }
}

function validateGlassType(glassType) {
  const key = normalizeKey(glassType);
  if (key === null || !Object.prototype.hasOwnProperty.call(GLASS_RATES, key)) {
    throw new QuoteError("UNKNOWN_GLASS", "glassType must be one of basic, tempered, laminated");
  }
  return key;
}

function validateEdgeFinish(edgeFinish) {
  const key = normalizeKey(edgeFinish);
  if (key === null || !Object.prototype.hasOwnProperty.call(EDGE_RATES, key)) {
    throw new QuoteError("UNKNOWN_EDGE", "edgeFinish must be one of none, polished, beveled");
  }
  return key;
}

function validatePromoCode(promoCode) {
  if (promoCode === undefined || promoCode === null || promoCode === "") return null;
  if (typeof promoCode !== "string") {
    throw new QuoteError("INVALID_PROMO", "promoCode must be SAVE10, FREESHIP, empty or absent");
  }
  const key = promoCode.toLowerCase();
  if (key !== "save10" && key !== "freeship") {
    throw new QuoteError("INVALID_PROMO", "promoCode must be SAVE10, FREESHIP, empty or absent");
  }
  return key;
}

export function estimateQuote(input) {
  const { areaM2, glassType, edgeFinish, quantity, promoCode } = input ?? {};

  validateArea(areaM2);
  validateQuantity(quantity);
  const glass = validateGlassType(glassType);
  const edge = validateEdgeFinish(edgeFinish);
  const promo = validatePromoCode(promoCode);

  const glassCost = round2(GLASS_RATES[glass] * areaM2);
  const runningMetres = 4 * Math.sqrt(areaM2);
  const edgeCost = round2(EDGE_RATES[edge] * runningMetres);
  const unitPrice = round2(glassCost + edgeCost);
  const subtotal = round2(unitPrice * quantity);

  let quantityRate = 0;
  if (quantity >= 25) quantityRate = 0.1;
  else if (quantity >= 10) quantityRate = 0.05;
  const quantityDiscount = round2(subtotal * quantityRate);
  const afterQuantityDiscount = round2(subtotal - quantityDiscount);

  let promoDiscount = 0;
  if (promo === "save10") {
    promoDiscount = round2(Math.min(afterQuantityDiscount * SAVE10_RATE, SAVE10_CAP));
  }
  const net = round2(afterQuantityDiscount - promoDiscount);

  if (net < MIN_ORDER) {
    throw new QuoteError("MIN_ORDER", `net order value ${net} PLN is below the ${MIN_ORDER} PLN minimum`);
  }

  const freeShipping = promo === "freeship" || net >= FREE_SHIPPING_THRESHOLD;
  const shipping = freeShipping ? 0 : SHIPPING;
  const vat = round2(net * VAT_RATE);
  const gross = round2(net + vat);

  return {
    currency: "PLN",
    glassCost,
    edgeCost,
    subtotal,
    quantityDiscount,
    promoDiscount,
    shipping,
    net,
    vat,
    gross,
  };
}
