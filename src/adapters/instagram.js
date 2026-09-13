export class InstagramAdapter {
  constructor({ accessToken, accountId, graphVersion = "v24.0" }) {
    this.accessToken = accessToken;
    this.accountId = accountId;
    this.baseUrl = `https://graph.instagram.com/${graphVersion}`;
  }

  async request(path, options = {}) {
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.set("access_token", this.accessToken);
    const response = await fetch(url, options);
    const result = await response.json();
    if (!response.ok) throw new Error(`Instagram API failed (${response.status}): ${result.error?.message ?? "unknown error"}`);
    return result;
  }

  listMedia() {
    return this.request(`/${this.accountId}/media?fields=id,caption,media_type,permalink,timestamp&limit=25`);
  }

  listComments(mediaId) {
    return this.request(`/${mediaId}/comments?fields=id,text,timestamp,from,parent_id&limit=100`);
  }

  replyToComment(commentId, message) {
    return this.request(`/${commentId}/replies`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ message })
    });
  }

  subscribeToComments() {
    return this.request(`/${this.accountId}/subscribed_apps?subscribed_fields=comments`, { method: "POST" });
  }
}
