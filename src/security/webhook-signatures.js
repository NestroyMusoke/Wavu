import { createHmac, timingSafeEqual } from "node:crypto";

function safeHexEqual(left, right) {
  if (!/^[a-f0-9]+$/i.test(left) || !/^[a-f0-9]+$/i.test(right) || left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export function verifyMetaSignature({ secret, rawBody, header }) {
  if (!secret) return true;
  const received = String(header ?? "").replace(/^sha256=/, "");
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return safeHexEqual(received, expected);
}

export function verifyTikTokSignature({ secret, rawBody, header, nowSeconds = Math.floor(Date.now() / 1000), toleranceSeconds = 300 }) {
  if (!secret) return true;
  const parts = Object.fromEntries(String(header ?? "").split(",").map((part) => part.trim().split("=", 2)));
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp) || Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;
  const expected = createHmac("sha256", secret).update(`${parts.t}.${rawBody}`).digest("hex");
  return safeHexEqual(parts.s ?? "", expected);
}
