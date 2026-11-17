// ABC analysis lives in index.html between the ABC-START / ABC-END markers.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const code = html.slice(html.indexOf("// ── ABC-START"), html.indexOf("// ── ABC-END"));
const ctx = {};
vm.runInNewContext(code, ctx);
const abcAnalysis = (x) => JSON.parse(JSON.stringify(ctx.abcAnalysis(x)));

const inv = (items) => ({ items });
const it = (id, qty, price) => ({ id, name: id, qty, price });

test("abc: 80/15/5 split by revenue, top seller always A", () => {
  const r = abcAnalysis({
    products: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "idle" }].map((p) => ({ ...p, name: p.id })),
    invoices: [inv([it("a", 70, 10), it("b", 15, 10)]), inv([it("c", 10, 10), it("d", 5, 10)])],
    warehouseStock: { idle: { qty: 4 } },
    months: 1,
  });
  assert.deepEqual(r.rows.map((x) => [x.productId, x.cls]), [["a", "A"], ["b", "A"], ["c", "B"], ["d", "C"]]);
  assert.equal(r.total, 1000);
  assert.deepEqual(r.idle.map((x) => x.productId), ["idle"]);
  assert.equal(r.summary.A.count, 2);
  assert.equal(r.summary.idle, 1);
});

test("abc: single product is A even with 100% share", () => {
  const r = abcAnalysis({ products: [], invoices: [inv([it("x", 1, 5)])] });
  assert.equal(r.rows[0].cls, "A");
});

test("abc: sold basis uses partner reports and counts points", () => {
  const r = abcAnalysis({
    products: [{ id: "a", name: "a" }, { id: "b", name: "b" }],
    reports: [
      { buyerId: "p1", items: [{ productId: "b", name: "b", sold: 9 }, { productId: "a", name: "a", sold: 1 }] },
      { buyerId: "p2", items: [{ productId: "b", name: "b", sold: 6 }] },
    ],
    basis: "sold",
  });
  assert.equal(r.rows[0].productId, "b");
  assert.equal(r.rows[0].sold, 15);
  assert.equal(r.rows[0].sellingPoints, 2);
});

test("abc: advice — low stock for A, swap for idle shelf products, spread hits", () => {
  const stock = (pids) => Object.fromEntries(pids.map((p) => [p, { qty: 3 }]));
  const r = abcAnalysis({
    products: ["hit", "dust"].map((id) => ({ id, name: id })),
    invoices: [inv([it("hit", 30, 100)])],
    retailStock: { p1: stock(["hit", "dust"]), p2: stock(["dust"]), p3: stock(["dust"]), p4: stock(["dust"]) },
    warehouseStock: { hit: { qty: 5 } },
    months: 3,
  });
  const hit = r.rows.find((x) => x.productId === "hit");
  assert.deepEqual(hit.tips.map((t) => t.k), ["low", "spread"]);
  const dust = r.idle.find((x) => x.productId === "dust");
  assert.deepEqual(dust.tips.map((t) => t.k), ["swap"]);
  assert.equal(r.pointsTotal, 4);
});
