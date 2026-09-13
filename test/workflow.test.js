import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.js";
import { WavuWorkflow } from "../src/domain/workflow.js";
import { evaluateState } from "../src/evaluate.js";

function setup() {
  const store = new Store({ persist: false });
  const workflow = new WavuWorkflow({ store, publicBaseUrl: "http://test" });
  return { store, workflow };
}

const buyerComment = (commentId = "c1", customerHandle = "@amina") => ({
  commentId,
  postId: "demo_blue_dress",
  customerHandle,
  text: "How much and do you have size M?",
  source: "instagram"
});

test("grounds price and stock in catalog data", () => {
  const { workflow } = setup();
  const result = workflow.receiveSocialComment(buyerComment());
  assert.equal(result.result.status, "answered");
  assert.match(result.result.reply, /UGX 65,000/);
  assert.match(result.result.reply, /1 left/);
  assert.ok(result.result.handoff.token.startsWith("WV-"));
});

test("ignores emoji-only noise", () => {
  const { workflow, store } = setup();
  const result = workflow.receiveSocialComment({ ...buyerComment(), text: "🔥🔥🔥" });
  assert.equal(result.result.status, "ignored");
  assert.equal(Object.keys(store.state.handoffs).length, 0);
});

test("duplicate comment webhook does not create a second handoff", () => {
  const { workflow, store } = setup();
  workflow.receiveSocialComment(buyerComment());
  const second = workflow.receiveSocialComment(buyerComment());
  assert.equal(second.duplicate, true);
  assert.equal(Object.keys(store.state.handoffs).length, 1);
});

test("reservation decrements stock only after confirmation", () => {
  const { workflow, store } = setup();
  const comment = workflow.receiveSocialComment(buyerComment());
  const token = comment.result.handoff.token;
  assert.equal(store.findProduct("demo_blue_dress", "M").stock, 1);
  const context = workflow.receiveWhatsAppMessage({ messageId: "wa1", customerAlias: "Amina", text: token });
  assert.equal(context.reserved, false);
  assert.equal(store.findProduct("demo_blue_dress", "M").stock, 1);
  const confirmed = workflow.receiveWhatsAppMessage({ messageId: "wa2", customerAlias: "Amina", text: `CONFIRM ${token}` });
  assert.equal(confirmed.reserved, true);
  assert.equal(store.findProduct("demo_blue_dress", "M").stock, 0);
});

test("duplicate confirmation is idempotent", () => {
  const { workflow, store } = setup();
  const token = workflow.receiveSocialComment(buyerComment()).result.handoff.token;
  const first = workflow.receiveWhatsAppMessage({ messageId: "wa1", customerAlias: "Amina", text: `CONFIRM ${token}` });
  const second = workflow.receiveWhatsAppMessage({ messageId: "wa2", customerAlias: "Amina", text: `CONFIRM ${token}` });
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(Object.keys(store.state.orders).length, 1);
  assert.equal(store.findProduct("demo_blue_dress", "M").stock, 0);
});

test("two buyers cannot reserve the same final unit", () => {
  const { workflow, store } = setup();
  const firstToken = workflow.receiveSocialComment(buyerComment("c1", "@amina")).result.handoff.token;
  const secondToken = workflow.receiveSocialComment(buyerComment("c2", "@sarah")).result.handoff.token;
  const first = workflow.receiveWhatsAppMessage({ messageId: "wa1", customerAlias: "Amina", text: `CONFIRM ${firstToken}` });
  const second = workflow.receiveWhatsAppMessage({ messageId: "wa2", customerAlias: "Sarah", text: `CONFIRM ${secondToken}` });
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(second.code, "OUT_OF_STOCK");
  assert.equal(Object.keys(store.state.orders).length, 1);
  assert.equal(store.findProduct("demo_blue_dress", "M").stock, 0);
  assert.equal(evaluateState(store.snapshot()).pass, true);
});

test("unknown product asks instead of guessing", () => {
  const { workflow } = setup();
  const result = workflow.receiveSocialComment({ ...buyerComment(), postId: "missing_post" });
  assert.equal(result.result.status, "needs_clarification");
  assert.match(result.result.reply, /Which product/);
});
