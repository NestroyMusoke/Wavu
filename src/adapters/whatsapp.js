export class WhatsAppAdapter {
  constructor({ accessToken, phoneNumberId, graphVersion = "v24.0" }) {
    this.accessToken = accessToken;
    this.phoneNumberId = phoneNumberId;
    this.baseUrl = `https://graph.facebook.com/${graphVersion}`;
  }

  async sendText({ to, text }) {
    const response = await fetch(`${this.baseUrl}/${this.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.accessToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { preview_url: false, body: text } })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(`WhatsApp API request failed (${response.status}): ${result.error?.message ?? "unknown error"}`);
    return result;
  }
}
