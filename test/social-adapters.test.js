import test from "node:test";
import assert from "node:assert/strict";
import { InstagramAdapter } from "../src/adapters/instagram.js";
import { TikTokBusinessAdapter } from "../src/adapters/tiktok-business.js";

test("Instagram comment replies use the comment replies edge", async () => {
  const adapter = new InstagramAdapter({ accessToken: "secret", accountId: "ig1" });
  adapter.request = async (path, options) => ({ path, options });
  const result = await adapter.replyToComment("comment1", "Grounded answer");
  assert.equal(result.path, "/comment1/replies");
  assert.match(String(result.options.body), /Grounded%20answer|Grounded\+answer/);
});

test("TikTok organic replies include business, video, and comment context", async () => {
  const adapter = new TikTokBusinessAdapter({ accessToken: "secret", businessId: "biz1" });
  adapter.request = async (path, options) => ({ path, options });
  const result = await adapter.replyToComment({ videoId: "video1", commentId: "comment1", text: "Grounded answer" });
  assert.equal(result.path, "/business/comment/reply/create/");
  assert.deepEqual(result.options.body, { business_id: "biz1", video_id: "video1", comment_id: "comment1", text: "Grounded answer" });
});
