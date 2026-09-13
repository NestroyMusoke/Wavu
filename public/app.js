const $ = (selector) => document.querySelector(selector);
const scenarios = {
  price: { commentId: "c-price-1", postId: "demo_blue_dress", customerHandle: "@amina", text: "How much and do you have medium?", source: "instagram-demo" },
  noise: { commentId: "c-noise-1", postId: "demo_blue_dress", customerHandle: "@jojo", text: "🔥🔥🔥", source: "instagram-demo" },
  bulk: { commentId: "c-bulk-1", postId: "demo_blue_dress", customerHandle: "@eventsbyjo", text: "I need 20 pieces this weekend", source: "instagram-demo" },
  second: { commentId: "c-price-2", postId: "demo_blue_dress", customerHandle: "@sarah", text: "Price? I want size M", source: "instagram-demo" }
};
let activeToken = null;
let messageSequence = 0;

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { "content-type": "application/json" }, ...options });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.reply ?? data.error ?? "Request failed"), { data });
  return data;
}

async function refresh() {
  const [state, evaluation, health, google] = await Promise.all([api("/api/state"), api("/api/evaluate"), api("/health"), api("/api/integrations/google")]);
  const events = state.events;
  $("#events").innerHTML = events.length ? events.map((event) => `<div class="event ${event.status}"><i class="dot"></i><time>${new Date(event.occurredAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})}<br>${event.channel}</time><p><strong>${event.type.replaceAll('_',' ')}</strong><br>${escapeHtml(event.detail)}</p></div>`).join("") : '<p class="empty">Run a scenario to watch Wavu work.</p>';
  $("#products").innerHTML = state.products.map((p) => `<div class="product"><strong>${p.name}</strong><span>Size ${p.variant}</span><span>${p.currency} ${p.price.toLocaleString()}</span><span class="pill">${p.stock} in stock</span></div>`).join("");
  $("#assertions").innerHTML = `<div class="assert-grid">${evaluation.assertions.map((a) => `<div class="assertion ${a.pass?'pass':'fail'}">${a.name}</div>`).join("")}</div>`;
  $("#intentCount").textContent = Object.values(state.comments).filter((c) => c.classification?.actionable).length;
  $("#orderCount").textContent = Object.keys(state.orders).length;
  $("#testScore").textContent = `${evaluation.passed}/${evaluation.total}`;
  $("#runtimeMode").textContent = health.ai?.configured ? "GEMINI + LIVE APPS" : "SAFE FALLBACK";
  $("#sheetStatus").textContent = google.ready && !google.lastError ? "● Google Sheets live" : google.lastError ? "Google Sheets fallback" : "Google Sheets connecting…";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[char]);
}

async function postComment(key) {
  const result = await api("/api/demo/comment", { method: "POST", body: JSON.stringify(scenarios[key]) });
  if (result.result?.handoff?.token && key === "price") activeToken = result.result.handoff.token;
  await refresh();
}

document.querySelectorAll("[data-comment]").forEach((button) => button.addEventListener("click", () => postComment(button.dataset.comment)));
$("#continue").addEventListener("click", async () => {
  if (!activeToken) await postComment("price");
  messageSequence += 1;
  await api("/api/demo/telegram", { method: "POST", body: JSON.stringify({ messageId: `tg-${messageSequence}`, customerAlias: "Amina", text: `CONFIRM ${activeToken}`, deliveryLocation: "Entebbe" }) });
  await refresh();
});
$("#secondBuyer").addEventListener("click", async () => {
  const result = await api("/api/demo/comment", { method: "POST", body: JSON.stringify(scenarios.second) });
  const token = result.result?.handoff?.token;
  if (token) {
    messageSequence += 1;
    try { await api("/api/demo/whatsapp", { method: "POST", body: JSON.stringify({ messageId: `wa-${messageSequence}`, customerAlias: "Sarah", text: `CONFIRM ${token}`, deliveryLocation: "Kampala" }) }); } catch {}
  }
  await refresh();
});
$("#reset").addEventListener("click", async () => { await api("/api/reset", { method: "POST" }); activeToken = null; await refresh(); });
$("#evaluate").addEventListener("click", refresh);
refresh();
