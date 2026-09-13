import { getGoogleAccessToken, loadServiceAccount } from "./google-auth.js";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

function encodedRange(range) {
  return encodeURIComponent(range).replaceAll("%21", "!");
}

export class GoogleSheetsAdapter {
  constructor({ spreadsheetId, serviceAccountFile }) {
    this.spreadsheetId = spreadsheetId;
    this.serviceAccountFile = serviceAccountFile;
    this.credentials = null;
  }

  async token(scopes = SCOPES) {
    this.credentials ??= await loadServiceAccount(this.serviceAccountFile);
    return getGoogleAccessToken({ credentials: this.credentials, scopes });
  }

  async request(path, options = {}) {
    const token = await this.token();
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}${path}`, {
      ...options,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...options.headers }
    });
    const result = await response.json();
    if (!response.ok) throw new Error(`Google Sheets request failed (${response.status}): ${result.error?.message ?? "unknown error"}`);
    return result;
  }

  async read(range) {
    return this.request(`/values/${encodedRange(range)}`);
  }

  async append(range, values) {
    return this.request(`/values/${encodedRange(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
      method: "POST",
      body: JSON.stringify({ values })
    });
  }

  async update(range, values) {
    return this.request(`/values/${encodedRange(range)}?valueInputOption=USER_ENTERED`, {
      method: "PUT",
      body: JSON.stringify({ values })
    });
  }
}

function table(headers, rows) {
  return [headers, ...rows.map((row) => headers.map((header) => row[header] ?? ""))];
}

export class GoogleSheetsMirror {
  constructor({ adapter }) {
    this.adapter = adapter;
    this.queue = Promise.resolve();
    this.status = { configured: true, ready: false, syncing: false, lastSyncedAt: null, lastError: null };
  }

  async loadProducts() {
    const result = await this.adapter.read("Products!A1:L1000");
    const [headers = [], ...rows] = result.values ?? [];
    const products = rows.filter((row) => row[0]).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index]])));
    return products.map((row) => ({
      productId: row.product_id,
      postId: row.post_id,
      name: row.name,
      description: row.description,
      currency: row.currency,
      price: Number(row.price),
      variant: row.variant,
      stock: Number(row.stock),
      location: row.location,
      deliveryZones: row.delivery_zones,
      active: String(row.active).toLowerCase() !== "false",
      updatedAt: row.updated_at
    }));
  }

  enqueue(snapshot) {
    this.status.syncing = true;
    this.queue = this.queue.then(() => this.sync(snapshot)).catch((error) => {
      this.status.lastError = error.message;
    }).finally(() => {
      this.status.syncing = false;
    });
    return this.queue;
  }

  async sync(snapshot) {
    const productHeaders = ["product_id", "post_id", "name", "description", "currency", "price", "variant", "stock", "location", "delivery_zones", "active", "updated_at"];
    const products = snapshot.products.map((product) => ({
      product_id: product.productId, post_id: product.postId, name: product.name, description: product.description,
      currency: product.currency, price: product.price, variant: product.variant, stock: product.stock,
      location: product.location,
      delivery_zones: typeof product.deliveryZones === "string" ? product.deliveryZones : JSON.stringify(product.deliveryZones ?? {}),
      active: product.active, updated_at: product.updatedAt ?? new Date().toISOString()
    }));
    const orderHeaders = ["order_id", "created_at", "customer_alias", "channel", "product_id", "variant", "quantity", "unit_price", "delivery_location", "status", "source_comment_id", "handoff_token"];
    const orders = Object.values(snapshot.orders).map((order) => ({
      order_id: order.orderId, created_at: order.createdAt, customer_alias: order.customerAlias, channel: order.channel,
      product_id: order.productId, variant: order.variant, quantity: order.quantity, unit_price: order.unitPrice,
      delivery_location: order.deliveryLocation, status: order.status, source_comment_id: order.sourceCommentId, handoff_token: order.handoffToken
    }));
    const handoffHeaders = ["token", "created_at", "expires_at", "source", "post_id", "comment_id", "customer_handle", "product_id", "requested_variant", "intents", "consumed_at"];
    const handoffs = Object.values(snapshot.handoffs).map((handoff) => ({ ...handoff, created_at: handoff.createdAt, expires_at: handoff.expiresAt, post_id: handoff.postId, comment_id: handoff.commentId, customer_handle: handoff.customerHandle, product_id: handoff.productId, requested_variant: handoff.requestedVariant, intents: handoff.intents?.join(","), consumed_at: handoff.consumedAt ?? "" }));
    const eventHeaders = ["event_id", "occurred_at", "workflow_id", "event_type", "channel", "external_id", "status", "detail"];
    const events = snapshot.events.map((event, index) => ({ event_id: `${event.workflowId ?? "NOFLOW"}-${index + 1}`, occurred_at: event.occurredAt, workflow_id: event.workflowId ?? "", event_type: event.type, channel: event.channel, external_id: event.externalId, status: event.status, detail: event.detail }));

    await Promise.all([
      this.adapter.update("Products!A1", table(productHeaders, products)),
      this.adapter.update("Orders!A1", table(orderHeaders, orders)),
      this.adapter.update("Handoffs!A1", table(handoffHeaders, handoffs)),
      this.adapter.update("Events!A1", table(eventHeaders, events))
    ]);
    this.status.ready = true;
    this.status.lastSyncedAt = new Date().toISOString();
    this.status.lastError = null;
  }
}
