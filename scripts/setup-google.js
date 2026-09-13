import { getGoogleAccessToken, loadServiceAccount } from "../src/adapters/google-auth.js";

const [keyFile, ownerEmail] = process.argv.slice(2);
if (!keyFile || !ownerEmail) {
  console.error("Usage: node scripts/setup-google.js <service-account-json> <owner-email>");
  process.exit(1);
}

const credentials = await loadServiceAccount(keyFile);
const token = await getGoogleAccessToken({
  credentials,
  scopes: ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive"]
});

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...options.headers }
  });
  const text = await response.text();
  const result = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`${response.status} ${result.error?.message ?? text}`);
  return result;
}

const spreadsheet = await request("https://sheets.googleapis.com/v4/spreadsheets", {
  method: "POST",
  body: JSON.stringify({
    properties: { title: "Wavu Demo Store" },
    sheets: ["Products", "Orders", "Handoffs", "Events"].map((title) => ({ properties: { title } }))
  })
});

const spreadsheetId = spreadsheet.spreadsheetId;
const values = {
  Products: [
    ["product_id", "post_id", "name", "description", "currency", "price", "variant", "stock", "location", "delivery_zones", "active", "updated_at"],
    ["dress_blue_01", "demo_blue_dress", "Blue Summer Dress", "Blue occasion dress", "UGX", 65000, "M", 1, "Ntinda, Kampala", "Kampala:5000,Entebbe:12000,Mukono:10000", true, "2026-09-13"],
    ["dress_blue_01", "demo_blue_dress", "Blue Summer Dress", "Blue occasion dress", "UGX", 65000, "L", 3, "Ntinda, Kampala", "Kampala:5000,Entebbe:12000,Mukono:10000", true, "2026-09-13"],
    ["dress_red_02", "demo_red_dress", "Red Evening Dress", "Red alternative dress", "UGX", 70000, "M", 4, "Ntinda, Kampala", "Kampala:5000,Entebbe:12000,Mukono:10000", true, "2026-09-13"]
  ],
  Orders: [["order_id", "created_at", "customer_alias", "channel", "product_id", "variant", "quantity", "unit_price", "delivery_location", "status", "source_comment_id", "handoff_token"]],
  Handoffs: [["token", "created_at", "expires_at", "source", "post_id", "comment_id", "customer_handle", "product_id", "requested_variant", "intents", "consumed_at"]],
  Events: [["event_id", "occurred_at", "workflow_id", "event_type", "channel", "external_id", "status", "detail"]]
};

for (const [sheet, rows] of Object.entries(values)) {
  await request(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${sheet}!A1?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    body: JSON.stringify({ values: rows })
  });
}

await request(`https://www.googleapis.com/drive/v3/files/${spreadsheetId}/permissions?sendNotificationEmail=false`, {
  method: "POST",
  body: JSON.stringify({ type: "user", role: "writer", emailAddress: ownerEmail })
});

console.log(`GOOGLE_SHEET_ID=${spreadsheetId}`);
console.log(`SHEET_URL=https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`);
console.log(`SHARED_WITH=${ownerEmail}`);
