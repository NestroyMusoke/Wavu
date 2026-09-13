import { classifyComment } from "./classifier.js";

function money(currency, amount) {
  return `${currency} ${Number(amount).toLocaleString("en-US")}`;
}

function whatsappLink(publicBaseUrl, token) {
  const message = `Hi, I am asking about the item from social media — ${token}`;
  const target = process.env.DEMO_WHATSAPP_NUMBER?.replace(/\D/g, "") ?? "";
  return target
    ? `https://wa.me/${target}?text=${encodeURIComponent(message)}`
    : `${publicBaseUrl}/?handoff=${encodeURIComponent(token)}`;
}

function responseFor({ product, classification, handoff, publicBaseUrl }) {
  const intents = new Set(classification.intents);
  if (classification.category === "complaint") {
    return "We're sorry about this. A person from the shop will review your order and contact you privately.";
  }
  if (classification.category === "needs_human") {
    return `Thanks for asking. ${money(product.currency, product.price)} is the listed price; the owner will review your request privately.`;
  }
  if (classification.category === "high_value") {
    return `We can help with a bulk order. Continue privately so the owner can confirm quantity and pricing: ${whatsappLink(publicBaseUrl, handoff.token)}`;
  }

  const parts = [];
  if (intents.has("price")) parts.push(`It is ${money(product.currency, product.price)}`);
  if (intents.has("stock")) {
    parts.push(product.stock > 0
      ? `${product.variant} is available now (${product.stock} left)`
      : `${product.variant} is currently sold out`);
  }
  if (intents.has("location")) parts.push(`we are in ${product.location}`);
  if (intents.has("delivery")) parts.push("delivery is available to configured areas");
  const answer = parts.length ? `${parts.join("; ")}.` : "Thanks for asking.";
  if (product.stock < 1) return answer;
  return `${answer} Continue on WhatsApp to reserve it: ${whatsappLink(publicBaseUrl, handoff.token)}`;
}

export class WavuWorkflow {
  constructor({ store, publicBaseUrl = "http://localhost:8787" }) {
    this.store = store;
    this.publicBaseUrl = publicBaseUrl;
  }

  receiveSocialComment(input) {
    const comment = {
      commentId: String(input.commentId),
      postId: String(input.postId),
      customerHandle: String(input.customerHandle ?? "social_customer"),
      text: String(input.text ?? ""),
      source: String(input.source ?? "demo")
    };

    if (this.store.state.comments[comment.commentId]) {
      const existing = this.store.state.comments[comment.commentId];
      this.store.addEvent({ workflowId: existing.workflowId, type: "duplicate_ignored", channel: comment.source, externalId: comment.commentId, status: "safe", detail: "Duplicate comment webhook ignored" });
      return { ok: true, duplicate: true, result: structuredClone(existing) };
    }

    const classification = classifyComment(comment.text);
    if (!classification.actionable) {
      const result = { ...comment, classification, status: "ignored" };
      this.store.state.comments[comment.commentId] = result;
      this.store.addEvent({ workflowId: null, type: "comment_ignored", channel: comment.source, externalId: comment.commentId, status: "safe", detail: `${comment.customerHandle}: ${comment.text}` });
      return { ok: true, duplicate: false, result };
    }

    const product = this.store.findProduct(comment.postId, classification.requestedVariant);
    if (!product) {
      const result = { ...comment, classification, status: "needs_clarification", reply: "Which product or size are you asking about?" };
      this.store.state.comments[comment.commentId] = result;
      this.store.addEvent({ workflowId: null, type: "clarification_requested", channel: comment.source, externalId: comment.commentId, status: "needs_human", detail: result.reply });
      return { ok: true, duplicate: false, result };
    }

    const handoff = this.store.createHandoff({
      source: comment.source,
      postId: comment.postId,
      commentId: comment.commentId,
      customerHandle: comment.customerHandle,
      productId: product.productId,
      requestedVariant: classification.requestedVariant ?? product.variant,
      intents: classification.intents
    });
    const reply = responseFor({ product, classification, handoff, publicBaseUrl: this.publicBaseUrl });
    const result = { ...comment, workflowId: handoff.token, classification, product: structuredClone(product), handoff, reply, status: classification.category === "complaint" || classification.category === "needs_human" ? "needs_human" : "answered" };
    this.store.state.comments[comment.commentId] = result;
    this.store.addEvent({ workflowId: handoff.token, type: "comment_answered", channel: comment.source, externalId: comment.commentId, status: result.status, detail: reply });
    return { ok: true, duplicate: false, result };
  }

  receiveWhatsAppMessage({ messageId, customerAlias, text, deliveryLocation = "Pickup" }) {
    const token = String(text ?? "").match(/\bWV-\d{4}\b/i)?.[0]?.toUpperCase();
    if (!token) return { ok: false, code: "HANDOFF_TOKEN_MISSING", reply: "Please use the product link from the social-media reply so I know which item you mean." };

    const wantsConfirmation = /\b(confirm|reserve|yes|take it|i want it|order)\b/i.test(String(text));
    const handoff = this.store.state.handoffs[token];
    if (!handoff) return { ok: false, code: "UNKNOWN_TOKEN", reply: "That product link is not valid. Please return to the latest social-media reply." };
    const product = this.store.findProduct(handoff.postId, handoff.requestedVariant);
    if (!product) return { ok: false, code: "PRODUCT_OR_VARIANT_NOT_FOUND", reply: "I cannot verify that product or size, so I have asked the shop owner to help." };

    if (!wantsConfirmation) {
      const reply = product.stock > 0
        ? `You're asking about ${product.name}, size ${product.variant}, at ${money(product.currency, product.price)}. ${product.stock} left. Reply "CONFIRM ${token}" to reserve one.`
        : `${product.name}, size ${product.variant}, has just sold out. I can ask the owner about an alternative.`;
      this.store.addEvent({ workflowId: token, type: "whatsapp_context_restored", channel: "whatsapp", externalId: messageId, status: product.stock > 0 ? "awaiting_confirmation" : "out_of_stock", detail: reply });
      return { ok: true, reserved: false, reply, handoff: structuredClone(handoff), product: structuredClone(product) };
    }

    const reservation = this.store.reserve({ token, customerAlias, deliveryLocation });
    if (!reservation.ok) {
      const reply = reservation.code === "OUT_OF_STOCK"
        ? `${product.name}, size ${product.variant}, sold out before the reservation completed. I have not created an order; I can offer another size or the red alternative.`
        : "I could not safely complete that reservation. The shop owner has been asked to help.";
      this.store.addEvent({ workflowId: token, type: "reservation_failed", channel: "whatsapp", externalId: messageId, status: "failed_truthfully", detail: `${reservation.code}: ${reply}` });
      return { ...reservation, reply };
    }

    const reply = reservation.duplicate
      ? `Your reservation ${reservation.order.orderId} already exists—nothing was duplicated.`
      : `Reserved: ${reservation.order.productName}, size ${reservation.order.variant}, ${money(reservation.order.currency, reservation.order.unitPrice)}. Order ${reservation.order.orderId}.`;
    this.store.addEvent({ workflowId: token, type: reservation.duplicate ? "duplicate_reservation_ignored" : "inventory_reserved", channel: "whatsapp", externalId: messageId, status: "verified", detail: reply });
    return { ok: true, reserved: true, ...reservation, reply };
  }
}
