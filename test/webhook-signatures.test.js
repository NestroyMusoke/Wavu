import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyMetaSignature, verifySecretToken, verifyTikTokSignature } from "../src/security/webhook-signatures.js";

test("verifies Meta webhook HMAC and rejects tampering", () => {
  const secret = "meta-secret";
  const rawBody = '{"event":"comment"}';
  const header = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  assert.equal(verifyMetaSignature({ secret, rawBody, header }), true);
  assert.equal(verifyMetaSignature({ secret, rawBody: `${rawBody}x`, header }), false);
});

test("verifies TikTok webhook HMAC and timestamp freshness", () => {
  const secret = "tiktok-secret";
  const rawBody = '{"event":"comment"}';
  const timestamp = 1_700_000_000;
  const signature = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const header = `t=${timestamp},s=${signature}`;
  assert.equal(verifyTikTokSignature({ secret, rawBody, header, nowSeconds: timestamp }), true);
  assert.equal(verifyTikTokSignature({ secret, rawBody, header, nowSeconds: timestamp + 301 }), false);
});

test("verifies Telegram webhook secret without accepting missing or partial values", () => {
  assert.equal(verifySecretToken("telegram-secret", "telegram-secret"), true);
  assert.equal(verifySecretToken("telegram-secret", "telegram-secre"), false);
  assert.equal(verifySecretToken("telegram-secret", "wrong-secret"), false);
  assert.equal(verifySecretToken("telegram-secret", undefined), false);
});
