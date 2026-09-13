import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.js";
import { WavuWorkflow } from "../src/domain/workflow.js";

test("uses AI intent extraction while grounding the answer in catalog data", async () => {
  const store = new Store({ persist: false });
  const aiClassifier = { classify: async () => ({ actionable: true, category: "sales_question", intents: ["price", "stock"], requestedVariant: "M", confidence: 0.97, language: "Luganda", engine: "test-ai" }) };
  const workflow = new WavuWorkflow({ store, publicBaseUrl: "http://test", aiClassifier });
  const result = await workflow.receiveSocialCommentWithAI({ commentId: "lug-1", postId: "demo_blue_dress", customerHandle: "@nakato", text: "Muli nayo size M era eba sente meka?", source: "instagram" });
  assert.equal(result.result.classification.engine, "test-ai");
  assert.match(result.result.reply, /UGX 65,000/);
  assert.match(result.result.reply, /1 left/);
});

test("falls back safely when the AI service is unavailable", async () => {
  const store = new Store({ persist: false });
  const aiClassifier = { classify: async () => { throw new Error("offline"); } };
  const workflow = new WavuWorkflow({ store, publicBaseUrl: "http://test", aiClassifier });
  const result = await workflow.receiveSocialCommentWithAI({ commentId: "c1", postId: "demo_blue_dress", customerHandle: "@amina", text: "How much for size M?", source: "instagram" });
  assert.equal(result.result.status, "answered");
  assert.equal(result.result.classification.engine, "deterministic-fallback");
  assert.ok(store.state.events.some((event) => event.type === "ai_fallback"));
});
