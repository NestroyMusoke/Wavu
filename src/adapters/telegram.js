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
}
