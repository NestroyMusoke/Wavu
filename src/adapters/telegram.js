export class TelegramAdapter {
  constructor({ botToken, chatId }) {
    this.botToken = botToken;
    this.chatId = chatId;
  }

  async sendText({ text, chatId = this.chatId }) {
    const response = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.description ?? `Telegram request failed (${response.status})`);
    return data.result;
  }

  async getIdentity() {
    const response = await fetch(`https://api.telegram.org/bot${this.botToken}/getMe`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.description ?? `Telegram request failed (${response.status})`);
    return { id: data.result.id, name: data.result.first_name, username: data.result.username };
  }

  async setWebhook({ url, secretToken }) {
    const response = await fetch(`https://api.telegram.org/bot${this.botToken}/setWebhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, secret_token: secretToken, allowed_updates: ["message"] })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.description ?? `Telegram webhook setup failed (${response.status})`);
    return data;
  }
}
