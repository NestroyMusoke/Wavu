import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { Store } from "./store.js";
import { WavuWorkflow } from "./domain/workflow.js";
import { evaluateState } from "./evaluate.js";
import { GoogleSheetsAdapter, GoogleSheetsMirror } from "./adapters/google-sheets.js";
import { VertexCommentClassifier } from "./adapters/vertex-ai.js";
import { InstagramAdapter } from "./adapters/instagram.js";
import { TikTokBusinessAdapter } from "./adapters/tiktok-business.js";
import { verifyMetaSignature, verifyTikTokSignature } from "./security/webhook-signatures.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = resolve(root, "public");
const port = Number(process.env.PORT ?? 8787);
const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`;
const store = new Store();
const aiClassifier = process.env.GOOGLE_CLOUD_PROJECT
  ? new VertexCommentClassifier({
      projectId: process.env.GOOGLE_CLOUD_PROJECT,
      serviceAccountFile: process.env.GOOGLE_SERVICE_ACCOUNT_FILE,
      location: process.env.VERTEX_LOCATION ?? "global",
      model: process.env.VERTEX_MODEL ?? "gemini-2.5-flash"
    })
  : null;
const workflow = new WavuWorkflow({ store, publicBaseUrl, aiClassifier });
const instagram = process.env.META_ACCESS_TOKEN && process.env.INSTAGRAM_ACCOUNT_ID
  ? new InstagramAdapter({ accessToken: process.env.META_ACCESS_TOKEN, accountId: process.env.INSTAGRAM_ACCOUNT_ID, graphVersion: process.env.META_GRAPH_VERSION ?? "v24.0" })
  : null;
const tiktok = process.env.TIKTOK_ACCESS_TOKEN && process.env.TIKTOK_BUSINESS_ID
  ? new TikTokBusinessAdapter({ accessToken: process.env.TIKTOK_ACCESS_TOKEN, businessId: process.env.TIKTOK_BUSINESS_ID })
  : null;
let googleMirror = null;

async function configureGoogleSheets() {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const serviceAccountFile = process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
  if (!spreadsheetId) return;
  googleMirror = new GoogleSheetsMirror({
    adapter: new GoogleSheetsAdapter({ spreadsheetId, serviceAccountFile })
  });
  const products = await googleMirror.loadProducts();
  if (products.length) store.state.products = products;
  store.setChangeHandler((snapshot) => googleMirror.enqueue(snapshot));
  await googleMirror.enqueue(store.snapshot());
}

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg"
};

function send(res, status, body, contentType = "application/json; charset=utf-8") {
  res.writeHead(status, { "content-type": contentType, "cache-control": "no-store", "access-control-allow-origin": "*" });
  res.end(contentType.startsWith("application/json") ? JSON.stringify(body) : body);
}

async function readJson(req) {
  return JSON.parse(await readBody(req) || "{}");
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function parseMetaComments(payload) {
  const comments = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      if (!value.id || !value.text) continue;
      comments.push({
        commentId: value.id,
        postId: value.media?.id ?? value.media_id ?? "unknown",
        customerHandle: value.from?.username ?? value.username ?? "instagram_customer",
        text: value.text,
        source: "instagram"
      });
    }
  }
  return comments;
}

function parseWhatsAppMessages(payload) {
  const messages = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const message of change.value?.messages ?? []) {
        if (message.type !== "text") continue;
        messages.push({ messageId: message.id, customerAlias: message.from, text: message.text?.body ?? "" });
      }
    }
  }
  return messages;
}

function parseTikTokComments(payload) {
  const source = payload.data ?? payload;
  const comments = source.comments ?? source.comment_list ?? (source.comment ? [source.comment] : []);
  return comments.filter((comment) => comment.id && comment.text).map((comment) => ({
    commentId: String(comment.id),
    postId: String(comment.video_id ?? source.video_id ?? "unknown"),
    customerHandle: String(comment.username ?? comment.display_name ?? "tiktok_customer"),
    text: String(comment.text),
    source: "tiktok"
  }));
}

async function processExternalComment(comment, reply) {
  const result = await workflow.receiveSocialCommentWithAI(comment);
  if (!result.duplicate && result.result?.reply && result.result.status !== "ignored") {
    await reply(result.result.reply);
    store.addEvent({ workflowId: result.result.workflowId ?? null, type: "social_reply_posted", channel: comment.source, externalId: comment.commentId, status: "verified", detail: "Grounded reply posted to the original comment" });
  }
  return result;
}

async function serveStatic(pathname, res) {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  if (relative.includes("..")) return send(res, 400, { error: "invalid_path" });
  try {
    const file = await readFile(resolve(publicDir, relative));
    send(res, 200, file, mime[extname(relative)] ?? "application/octet-stream");
  } catch {
    send(res, 404, { error: "not_found" });
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, publicBaseUrl);
    if (req.method === "OPTIONS") return send(res, 204, "", "text/plain");
    if (req.method === "GET" && url.pathname === "/health") return send(res, 200, {
      status: "ok",
      app: "wavu",
      mode: process.env.APP_MODE ?? "demo",
      ai: { configured: Boolean(aiClassifier), provider: aiClassifier ? "vertex-ai" : null, model: process.env.VERTEX_MODEL ?? null },
      sheets: googleMirror?.status ?? { configured: false, ready: false }
    });
    if (req.method === "GET" && url.pathname === "/api/integrations") return send(res, 200, {
      instagram: { configured: Boolean(instagram) },
      tiktok: { configured: Boolean(tiktok) },
      whatsapp: { configured: Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) },
      googleSheets: googleMirror?.status ?? { configured: false, ready: false },
      vertexAi: { configured: Boolean(aiClassifier), model: process.env.VERTEX_MODEL ?? null }
    });
    if (req.method === "GET" && url.pathname === "/api/state") return send(res, 200, store.snapshot());
    if (req.method === "GET" && url.pathname === "/api/evaluate") return send(res, 200, evaluateState(store.snapshot()));
    if (req.method === "GET" && url.pathname === "/api/integrations/google") return send(res, 200, googleMirror?.status ?? { configured: false, ready: false });
    if (req.method === "POST" && url.pathname === "/api/integrations/google/sync") {
      if (!googleMirror) return send(res, 400, { configured: false, error: "google_sheets_not_configured" });
      await googleMirror.enqueue(store.snapshot());
      return send(res, googleMirror.status.lastError ? 502 : 200, googleMirror.status);
    }
    if (req.method === "POST" && url.pathname === "/api/reset") return send(res, 200, store.reset());

    if (req.method === "POST" && url.pathname === "/api/demo/comment") {
      const result = await workflow.receiveSocialCommentWithAI(await readJson(req));
      return send(res, 200, result);
    }
    if (req.method === "POST" && url.pathname === "/api/demo/whatsapp") {
      const result = workflow.receiveWhatsAppMessage(await readJson(req));
      return send(res, result.ok ? 200 : 400, result);
    }

    if (req.method === "GET" && url.pathname === "/webhooks/meta") {
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");
      if (mode === "subscribe" && token === process.env.WEBHOOK_VERIFY_TOKEN) return send(res, 200, challenge ?? "", "text/plain");
      return send(res, 403, { error: "verification_failed" });
    }

    if (req.method === "POST" && url.pathname === "/webhooks/meta") {
      const rawBody = await readBody(req);
      if (!verifyMetaSignature({ secret: process.env.META_APP_SECRET, rawBody, header: req.headers["x-hub-signature-256"] })) return send(res, 401, { error: "invalid_meta_signature" });
      const payload = JSON.parse(rawBody || "{}");
      const metaComments = parseMetaComments(payload);
      const results = await Promise.all([
        ...metaComments.map((comment) => instagram
          ? processExternalComment(comment, (reply) => instagram.replyToComment(comment.commentId, reply))
          : workflow.receiveSocialCommentWithAI(comment)),
        ...parseWhatsAppMessages(payload).map((message) => workflow.receiveWhatsAppMessage(message))
      ]);
      return send(res, 200, { received: true, processed: results.length, results });
    }

    if (req.method === "GET" && url.pathname === "/webhooks/tiktok") {
      return send(res, 200, url.searchParams.get("challenge") ?? "wavu-tiktok-webhook", "text/plain");
    }
    if (req.method === "POST" && url.pathname === "/webhooks/tiktok") {
      const rawBody = await readBody(req);
      if (!verifyTikTokSignature({ secret: process.env.TIKTOK_CLIENT_SECRET ?? process.env.TIKTOK_WEBHOOK_SECRET, rawBody, header: req.headers["tiktok-signature"] })) return send(res, 401, { error: "invalid_tiktok_signature" });
      const payload = JSON.parse(rawBody || "{}");
      const comments = parseTikTokComments(payload);
      const results = await Promise.all(comments.map((comment) => tiktok
        ? processExternalComment(comment, (reply) => tiktok.replyToComment({ videoId: comment.postId, commentId: comment.commentId, text: reply }))
        : workflow.receiveSocialCommentWithAI(comment)));
      return send(res, 200, { received: true, processed: results.length, results });
    }
    if (req.method === "POST" && url.pathname === "/api/integrations/tiktok/poll") {
      if (!tiktok) return send(res, 400, { error: "tiktok_not_configured" });
      const { videoId } = await readJson(req);
      if (!videoId) return send(res, 400, { error: "video_id_required" });
      const page = await tiktok.listComments(videoId);
      const comments = parseTikTokComments({ data: { ...page, video_id: videoId } });
      const results = await Promise.all(comments.map((comment) => processExternalComment(comment, (reply) => tiktok.replyToComment({ videoId, commentId: comment.commentId, text: reply }))));
      return send(res, 200, { processed: results.length, results, cursor: page.cursor, hasMore: page.has_more });
    }

    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/webhooks/")) return send(res, 404, { error: "not_found" });
    return serveStatic(url.pathname, res);
  } catch (error) {
    console.error(error);
    return send(res, 500, { error: "internal_error", message: error.message });
  }
});

configureGoogleSheets().then(() => {
  server.listen(port, () => console.log(`Wavu running at ${publicBaseUrl}`));
}).catch((error) => {
  console.error(`Google Sheets startup failed: ${error.message}`);
  server.listen(port, () => console.log(`Wavu running at ${publicBaseUrl} (local fallback)`));
});
