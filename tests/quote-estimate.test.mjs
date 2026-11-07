import test from "node:test";
import assert from "node:assert/strict";

import { estimateQuote, QuoteError } from "../scripts/quote-estimate.mjs";

const base = { areaM2: 2, glassType: "basic", edgeFinish: "none", quantity: 1 };

function throwsCode(input, code) {
  assert.throws(
    () => estimateQuote(input),
    (error) => error instanceof QuoteError && error.code === code && typeof error.message === "string" && error.message.length > 0,
  );
}

test("all three glass types use their per-m2 rate", () => {
  assert.equal(estimateQuote({ ...base, glassType: "basic" }).glassCost, 240);
  assert.equal(estimateQuote({ ...base, glassType: "tempered" }).glassCost, 420);
  assert.equal(estimateQuote({ ...base, glassType: "laminated" }).glassCost, 560);
});

test("glass type is case-insensitive and reported in the output", () => {
  const quote = estimateQuote({ ...base, glassType: "TEMPERED" });
  assert.equal(quote.glassCost, 420);
  assert.equal(quote.currency, "PLN");
});

test("all three edge finishes use running metres of a square panel", () => {
  assert.equal(estimateQuote({ ...base, edgeFinish: "none" }).edgeCost, 0);
  assert.equal(estimateQuote({ ...base, edgeFinish: "polished" }).edgeCost, 254.56);
  assert.equal(estimateQuote({ ...base, edgeFinish: "beveled" }).edgeCost, 509.12);
});

test("edge finish is case-insensitive", () => {
  assert.equal(estimateQuote({ ...base, edgeFinish: "Polished" }).edgeCost, 254.56);
});

test("quantity 1 has no discount and computes subtotal, net, VAT and gross", () => {
  const quote = estimateQuote({ areaM2: 2, glassType: "basic", edgeFinish: "none", quantity: 1 });
  assert.deepEqual(quote, {
    currency: "PLN",
    glassCost: 240,
    edgeCost: 0,
    subtotal: 240,
    quantityDiscount: 0,
    promoDiscount: 0,
    shipping: 49,
    net: 240,
    vat: 55.2,
    gross: 295.2,
  });
});

test("quantity boundary 9 has no discount", () => {
  const quote = estimateQuote({ areaM2: 1, glassType: "basic", edgeFinish: "none", quantity: 9 });
  assert.equal(quote.subtotal, 1080);
  assert.equal(quote.quantityDiscount, 0);
});

test("quantity boundary 10 gets a 5% discount", () => {
  const quote = estimateQuote({ areaM2: 1, glassType: "basic", edgeFinish: "none", quantity: 10 });
  assert.equal(quote.subtotal, 1200);
  assert.equal(quote.quantityDiscount, 60);
  assert.equal(quote.net, 1140);
});

test("quantity boundary 24 keeps the 5% discount", () => {
  const quote = estimateQuote({ areaM2: 1, glassType: "basic", edgeFinish: "none", quantity: 24 });
  assert.equal(quote.subtotal, 2880);
  assert.equal(quote.quantityDiscount, 144);
});

test("quantity boundary 25 gets a 10% discount", () => {
  const quote = estimateQuote({ areaM2: 1, glassType: "basic", edgeFinish: "none", quantity: 25 });
  assert.equal(quote.subtotal, 3000);
  assert.equal(quote.quantityDiscount, 300);
  assert.equal(quote.net, 2700);
});

test("quantity boundary 500 is accepted", () => {
  const quote = estimateQuote({ areaM2: 1, glassType: "basic", edgeFinish: "none", quantity: 500 });
  assert.equal(quote.subtotal, 60000);
  assert.equal(quote.quantityDiscount, 6000);
  assert.equal(quote.net, 54000);
});

test("area boundary 1000 is accepted", () => {
  const quote = estimateQuote({ areaM2: 1000, glassType: "basic", edgeFinish: "none", quantity: 1 });
  assert.equal(quote.glassCost, 120000);
  assert.equal(quote.net, 120000);
  assert.equal(quote.shipping, 0);
});

test("invalid areas 0, negative and NaN are rejected", () => {
  for (const areaM2 of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) throwsCode({ ...base, areaM2 }, "INVALID_AREA");
});

test("invalid quantities 0, 1.5 and 501 are rejected", () => {
  for (const quantity of [0, 1.5, 501]) throwsCode({ ...base, quantity }, "INVALID_QUANTITY");
});

test("unknown glass types are rejected", () => {
  throwsCode({ ...base, glassType: "mirrored" }, "UNKNOWN_GLASS");
  throwsCode({ ...base, glassType: 42 }, "UNKNOWN_GLASS");
});

test("unknown edge finishes are rejected", () => {
  throwsCode({ ...base, edgeFinish: "rounded" }, "UNKNOWN_EDGE");
  throwsCode({ ...base, edgeFinish: null }, "UNKNOWN_EDGE");
});

test("invalid promo codes are rejected", () => {
  throwsCode({ ...base, promoCode: "SAVE20" }, "INVALID_PROMO");
  throwsCode({ ...base, promoCode: true }, "INVALID_PROMO");
});

test("absent, null and empty promo codes are accepted", () => {
  assert.equal(estimateQuote({ ...base }).promoDiscount, 0);
  assert.equal(estimateQuote({ ...base, promoCode: null }).promoDiscount, 0);
  assert.equal(estimateQuote({ ...base, promoCode: "" }).promoDiscount, 0);
});

test("SAVE10 takes 10% and is case-insensitive", () => {
  const quote = estimateQuote({ ...base, promoCode: "save10" });
  assert.equal(quote.promoDiscount, 24);
  assert.equal(quote.net, 216);
});

test("SAVE10 discount is capped at 200 PLN", () => {
  const quote = estimateQuote({ areaM2: 10, glassType: "basic", edgeFinish: "none", quantity: 25, promoCode: "SAVE10" });
  assert.equal(quote.promoDiscount, 200);
  assert.equal(quote.net, 26800);
});

test("FREESHIP zeroes shipping without reducing the price", () => {
  const withPromo = estimateQuote({ ...base, promoCode: "FREESHIP" });
  const withoutPromo = estimateQuote(base);
  assert.equal(withPromo.shipping, 0);
  assert.equal(withoutPromo.shipping, 49);
  assert.equal(withPromo.net, withoutPromo.net);
});

test("free shipping threshold applies at exactly 2000 PLN net", () => {
  const quote = estimateQuote({ areaM2: 10 / 3, glassType: "basic", edgeFinish: "none", quantity: 5 });
  assert.equal(quote.net, 2000);
  assert.equal(quote.shipping, 0);
});

test("shipping is charged just below the 2000 PLN net threshold", () => {
  const quote = estimateQuote({ areaM2: 1, glassType: "tempered", edgeFinish: "none", quantity: 10 });
  assert.equal(quote.net, 1995);
  assert.equal(quote.shipping, 49);
});

test("minimum order 149.99 is rejected", () => {
  throwsCode({ areaM2: 149.99 / 120, glassType: "basic", edgeFinish: "none", quantity: 1 }, "MIN_ORDER");
});

test("minimum order 150 is accepted", () => {
  const quote = estimateQuote({ areaM2: 1.25, glassType: "basic", edgeFinish: "none", quantity: 1 });
  assert.equal(quote.net, 150);
});

test("net and gross stay additive with all rounded parts", () => {
  const quote = estimateQuote({ areaM2: 3.7, glassType: "laminated", edgeFinish: "beveled", quantity: 25, promoCode: "SAVE10" });
  assert.equal(quote.subtotal, Math.round((quote.subtotal + Number.EPSILON) * 100) / 100);
  assert.equal(quote.net, Math.round((quote.subtotal - quote.quantityDiscount - quote.promoDiscount + Number.EPSILON) * 100) / 100);
  assert.equal(quote.vat, Math.round((quote.net * 0.23 + Number.EPSILON) * 100) / 100);
  assert.equal(quote.gross, Math.round((quote.net + quote.vat + Number.EPSILON) * 100) / 100);
  assert.ok(quote.promoDiscount <= 200);
  assert.ok(quote.net >= 150);
});

test("repeated calls with equal input return deeply equal output", () => {
  const input = { areaM2: 2.5, glassType: "tempered", edgeFinish: "polished", quantity: 12, promoCode: "SAVE10" };
  assert.deepEqual(estimateQuote(input), estimateQuote(input));
  assert.deepEqual(estimateQuote({ ...input }), estimateQuote({ ...input }));
});
