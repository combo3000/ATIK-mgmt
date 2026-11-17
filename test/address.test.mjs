// splitAddressPhone lives in index.html between the ADDR-START / ADDR-END markers.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const ctx = {};
vm.runInNewContext(html.slice(html.indexOf("// ── ADDR-START"), html.indexOf("// ── ADDR-END")), ctx);
const split = (a) => JSON.parse(JSON.stringify(ctx.splitAddressPhone(a)));

test("address: phone with тел.: is moved out", () => {
  const r = split("Адреса: Україна, 01021, м. Київ, вул. Мечнікова, буд. № 9, тел.: +38 (044) 390-75-00");
  assert.equal(r.address, "Україна, 01021, м. Київ, вул. Мечнікова, буд. № 9");
  assert.deepEqual(r.phones, ["+38 (044) 390-75-00"]);
  assert.equal(r.changed, true);
});

test("address: bare mobile number and several phones", () => {
  const r = split("м. Львів, вул. Городоцька 5, 067 123 45 67; моб. 0501112233");
  assert.equal(r.address, "м. Львів, вул. Городоцька 5");
  assert.deepEqual(r.phones, ["067 123 45 67", "0501112233"]);
});

test("address: no phone — untouched, postcode and house numbers stay", () => {
  const r = split("79000, м. Львів, вул. Шевченка 120/2");
  assert.equal(r.address, "79000, м. Львів, вул. Шевченка 120/2");
  assert.deepEqual(r.phones, []);
  assert.equal(r.changed, false);
});
