import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const seedPath = resolve(root, "data", "seed.json");
const runtimePath = resolve(root, "data", "runtime.json");

function freshState() {
  const seed = JSON.parse(readFileSync(seedPath, "utf8"));
  return {
    products: seed.products,
    comments: {},
    handoffs: {},
    orders: {},
    events: [],
    sequences: { workflow: 0, order: 0 }
  };
}

export class Store {
  constructor({ persist = true, onChange = null } = {}) {
    this.persist = persist;
    this.onChange = onChange;
    this.state = persist && existsSync(runtimePath)
      ? JSON.parse(readFileSync(runtimePath, "utf8"))
      : freshState();
  }

  reset() {
    this.state = freshState();
    this.save();
    return this.snapshot();
  }

  save() {
    if (this.persist) {
      mkdirSync(dirname(runtimePath), { recursive: true });
      writeFileSync(runtimePath, JSON.stringify(this.state, null, 2));
    }
    this.onChange?.(this.snapshot());
  }

  setChangeHandler(handler) {
    this.onChange = handler;
  }

  snapshot() {
    return structuredClone(this.state);
  }

  nextId(type) {
    this.state.sequences[type] += 1;
    return `${type === "order" ? "ORD" : "WV"}-${String(this.state.sequences[type]).padStart(4, "0")}`;
  }

  addEvent(event) {
    this.state.events.unshift({ occurredAt: new Date().toISOString(), ...event });
    this.state.events = this.state.events.slice(0, 100);
    this.save();
  }

  findProduct(postId, variant = null) {
    const candidates = this.state.products.filter((product) => product.postId === postId && product.active);
    if (!candidates.length) return null;
    if (variant) return candidates.find((product) => product.variant === variant) ?? null;
    return candidates[0];
  }

  createHandoff(context) {
    const token = this.nextId("workflow");
    this.state.handoffs[token] = {
      token,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      consumedAt: null,
      ...context
    };
    this.save();
    return structuredClone(this.state.handoffs[token]);
  }

  reserve({ token, customerAlias = "Private-chat buyer", deliveryLocation = "Pickup", channel = "whatsapp" }) {
    const handoff = this.state.handoffs[token];
    if (!handoff) return { ok: false, code: "UNKNOWN_TOKEN" };
    if (Date.parse(handoff.expiresAt) < Date.now()) return { ok: false, code: "EXPIRED_TOKEN" };
    if (handoff.orderId) return { ok: true, duplicate: true, order: this.state.orders[handoff.orderId] };

    const product = this.findProduct(handoff.postId, handoff.requestedVariant);
    if (!product) return { ok: false, code: "PRODUCT_OR_VARIANT_NOT_FOUND" };
    if (product.stock < 1) return { ok: false, code: "OUT_OF_STOCK", product };

    product.stock -= 1;
    const orderId = this.nextId("order");
    const order = {
      orderId,
      createdAt: new Date().toISOString(),
      customerAlias,
      channel,
      productId: product.productId,
      productName: product.name,
      variant: product.variant,
      quantity: 1,
      currency: product.currency,
      unitPrice: product.price,
      deliveryLocation,
      status: "reserved",
      sourceCommentId: handoff.commentId,
      handoffToken: token
    };
    this.state.orders[orderId] = order;
    handoff.consumedAt = new Date().toISOString();
    handoff.orderId = orderId;
    this.save();
    return { ok: true, duplicate: false, order: structuredClone(order), remainingStock: product.stock };
  }
}
