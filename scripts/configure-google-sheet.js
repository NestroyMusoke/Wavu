import { getGoogleAccessToken, loadServiceAccount } from "../src/adapters/google-auth.js";

const [keyFile, spreadsheetId] = process.argv.slice(2);
if (!keyFile || !spreadsheetId) {
  console.error("Usage: node scripts/configure-google-sheet.js <service-account-json> <spreadsheet-id>");
  process.exit(1);
}

const credentials = await loadServiceAccount(keyFile);
const token = await getGoogleAccessToken({
  credentials,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
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

const base = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
const metadata = await request(`${base}?fields=sheets.properties`);
const sheets = metadata.sheets.map((sheet) => sheet.properties);
const desired = ["Products", "Orders", "Handoffs", "Events"];
const requests = [];

if (!sheets.some((sheet) => sheet.title === "Products")) {
  const first = sheets[0];
  requests.push({ updateSheetProperties: { properties: { sheetId: first.sheetId, title: "Products" }, fields: "title" } });
}
for (const title of desired.slice(1)) {
  if (!sheets.some((sheet) => sheet.title === title)) requests.push({ addSheet: { properties: { title } } });
}
if (requests.length) {
  await request(`${base}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests }) });
}

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
  await request(`${base}/values/${sheet}!A1?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    body: JSON.stringify({ values: rows })
  });
}

console.log(`GOOGLE_SHEET_ID=${spreadsheetId}`);
console.log(`SHEET_URL=https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`);
console.log(`SERVICE_ACCOUNT=${credentials.client_email}`);
