import test from "node:test";
import assert from "node:assert/strict";
import { GoogleSheetsMirror } from "../src/adapters/google-sheets.js";

test("loads products from Google Sheets into domain shape", async () => {
  const adapter = {
    read: async () => ({ values: [
      ["product_id", "post_id", "name", "description", "currency", "price", "variant", "stock", "location", "delivery_zones", "active", "updated_at"],
      ["p1", "post1", "Dress", "Blue dress", "UGX", "65000", "M", "2", "Ntinda", "Kampala:5000", "TRUE", "2026-09-13"]
    ] })
  };
  const mirror = new GoogleSheetsMirror({ adapter });
  const products = await mirror.loadProducts();
  assert.equal(products[0].productId, "p1");
  assert.equal(products[0].price, 65000);
  assert.equal(products[0].stock, 2);
  assert.equal(products[0].active, true);
});

test("syncs inventory, orders, handoffs, and events to four tabs", async () => {
  const updates = [];
  const adapter = { update: async (range, values) => updates.push({ range, values }) };
  const mirror = new GoogleSheetsMirror({ adapter });
  await mirror.sync({
    products: [{ productId: "p1", postId: "post1", name: "Dress", currency: "UGX", price: 65000, variant: "M", stock: 1, location: "Ntinda", deliveryZones: { Kampala: 5000 }, active: true }],
    orders: {}, handoffs: {}, events: []
  });
  assert.deepEqual(updates.map((update) => update.range).sort(), ["Events!A1", "Handoffs!A1", "Orders!A1", "Products!A1"]);
  assert.equal(mirror.status.ready, true);
  assert.match(updates.find((update) => update.range === "Products!A1").values[1][9], /Kampala/);
});
