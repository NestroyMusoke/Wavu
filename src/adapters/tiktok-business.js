export class TikTokBusinessAdapter {
  constructor({ accessToken, businessId, apiVersion = "v1.3" }) {
    this.accessToken = accessToken;
    this.businessId = businessId;
    this.baseUrl = `https://business-api.tiktok.com/open_api/${apiVersion}`;
  }

  async request(path, { method = "GET", query = {}, body } = {}) {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    const response = await fetch(url, {
      method,
      headers: { "Access-Token": this.accessToken, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined
    });
    const result = await response.json();
    if (!response.ok || (result.code && result.code !== 0)) throw new Error(`TikTok Business API failed (${response.status}): ${result.message ?? "unknown error"}`);
    return result.data ?? result;
  }

  listComments(videoId, { cursor = 0, maxCount = 100 } = {}) {
    return this.request("/business/comment/list/", {
      query: { business_id: this.businessId, video_id: videoId, cursor, max_count: maxCount }
    });
  }

  replyToComment({ videoId, commentId, text }) {
    return this.request("/business/comment/reply/create/", {
      method: "POST",
      body: { business_id: this.businessId, video_id: videoId, comment_id: commentId, text }
    });
  }
}
