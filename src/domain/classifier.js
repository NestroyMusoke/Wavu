const NOISE_ONLY = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s!.,]+$/u;

const patterns = {
  price: /(?:how\s*much|price|cost|hw\s*much|howmuch|rate)/i,
  stock: /(?:available|availability|in\s*stock|have\s+(?:it|this)|size\s*[a-z0-9]+)/i,
  location: /(?:where|located|location|find\s+you|shop\s+at)/i,
  delivery: /(?:deliver|delivery|send\s+to|bring\s+it|ship)/i,
  bulk: /(?:\b(?:[2-9]|[1-9]\d+)\s*(?:pieces|pcs|units|dresses|pairs)\b|wholesale|bulk)/i,
  negotiation: /(?:last\s+price|discount|reduce|best\s+price|nego|less)/i,
  complaint: /(?:damaged|broken|wrong|refund|complain|disappointed|scam|never\s+arrived)/i
};

function requestedVariant(text) {
  const match = text.match(/(?:size\s*)?\b(xs|s|m|l|xl|xxl|\d{2})\b/i);
  return match ? match[1].toUpperCase() : null;
}

export function classifyComment(text = "") {
  const normalized = String(text).trim();
  if (!normalized || NOISE_ONLY.test(normalized)) {
    return { actionable: false, category: "noise", intents: [], confidence: 0.99, requestedVariant: null };
  }

  const intents = Object.entries(patterns)
    .filter(([, pattern]) => pattern.test(normalized))
    .map(([intent]) => intent);

  if (intents.includes("complaint")) {
    return { actionable: true, category: "complaint", intents, confidence: 0.96, requestedVariant: requestedVariant(normalized) };
  }
  if (intents.includes("negotiation")) {
    return { actionable: true, category: "needs_human", intents, confidence: 0.92, requestedVariant: requestedVariant(normalized) };
  }
  if (intents.includes("bulk")) {
    return { actionable: true, category: "high_value", intents, confidence: 0.94, requestedVariant: requestedVariant(normalized) };
  }
  if (intents.length) {
    return { actionable: true, category: "sales_question", intents, confidence: 0.9, requestedVariant: requestedVariant(normalized) };
  }

  return { actionable: false, category: "uncertain", intents: [], confidence: 0.35, requestedVariant: requestedVariant(normalized) };
}
