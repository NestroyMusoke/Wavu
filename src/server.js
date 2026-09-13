import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { Store } from "./store.js";
import { WavuWorkflow } from "./domain/workflow.js";
import { evaluateState } from "./evaluate.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = resolve(root, "public");
const port = Number(process.env.PORT ?? 8787);
const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`;
const store = new Store();
const workflow = new WavuWorkflow({ store, publicBaseUrl });

const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };

function send(res, status, body, contentType = "application/json; charset=utf-8") {
  res.writeHead(status, { "content-type": contentType, "cache-control": "no-store", "access-control-allow-origin": "*" });
  res.end(contentType.startsWith("application/json") ? JSON.stringify(body) : body);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
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
    if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { status: "ok", app: "wavu", mode: process.env.APP_MODE ?? "demo" });
    if (req.method === "GET" && url.pathname === "/api/state") return send(res, 200, store.snapshot());
    if (req.method === "GET" && url.pathname === "/api/evaluate") return send(res, 200, evaluateState(store.snapshot()));
    if (req.method === "POST" && url.pathname === "/api/reset") return send(res, 200, store.reset());

    if (req.method === "POST" && url.pathname === "/api/demo/comment") {
      const result = workflow.receiveSocialComment(await readJson(req));
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
      const payload = await readJson(req);
      const results = [
        ...parseMetaComments(payload).map((comment) => workflow.receiveSocialComment(comment)),
        ...parseWhatsAppMessages(payload).map((message) => workflow.receiveWhatsAppMessage(message))
      ];
      return send(res, 200, { received: true, processed: results.length, results });
    }

    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/webhooks/")) return send(res, 404, { error: "not_found" });
    return serveStatic(url.pathname, res);
  } catch (error) {
    console.error(error);
    return send(res, 500, { error: "internal_error", message: error.message });
  }
});

server.listen(port, () => console.log(`Wavu running at ${publicBaseUrl}`));
