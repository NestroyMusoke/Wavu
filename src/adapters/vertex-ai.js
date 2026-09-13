import { getGoogleAccessToken, loadServiceAccount } from "./google-auth.js";

const VALID_CATEGORIES = new Set(["noise", "sales_question", "high_value", "needs_human", "complaint", "uncertain"]);
const VALID_INTENTS = new Set(["price", "stock", "location", "delivery", "bulk", "negotiation", "complaint"]);

export class VertexCommentClassifier {
  constructor({ projectId, serviceAccountFile, location = "global", model = "gemini-2.5-flash" }) {
    this.projectId = projectId;
    this.serviceAccountFile = serviceAccountFile;
    this.location = location;
    this.model = model;
    this.credentials = null;
  }

  async classify(text) {
    this.credentials ??= await loadServiceAccount(this.serviceAccountFile);
    const token = await getGoogleAccessToken({ credentials: this.credentials, scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
    const endpoint = `https://aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${this.location}/publishers/google/models/${this.model}:generateContent`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: "Classify a social-commerce comment for a small Ugandan business. Understand English, Luganda, Swahili, slang, shorthand, and spelling mistakes. Never invent price, inventory, product, location, delivery fee, or policy. Extract only buyer intent. Return JSON." }] },
        contents: [{ role: "user", parts: [{ text: String(text) }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 250,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              actionable: { type: "BOOLEAN" },
              category: { type: "STRING", enum: [...VALID_CATEGORIES] },
              intents: { type: "ARRAY", items: { type: "STRING", enum: [...VALID_INTENTS] } },
              requestedVariant: { type: "STRING", nullable: true },
              confidence: { type: "NUMBER" },
              language: { type: "STRING" },
              rationale: { type: "STRING" }
            },
            required: ["actionable", "category", "intents", "requestedVariant", "confidence", "language", "rationale"]
          }
        }
      })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(`Vertex AI request failed (${response.status}): ${body.error?.message ?? "unknown error"}`);
    const raw = body.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) throw new Error("Vertex AI returned no classification");
    const parsed = JSON.parse(raw);
    if (!VALID_CATEGORIES.has(parsed.category)) throw new Error("Vertex AI returned an invalid category");
    const variantText = parsed.requestedVariant ? String(parsed.requestedVariant) : "";
    const variantMatch = variantText.match(/\b(XXL|XL|XS|S|M|L|\d{2})\b/i);
    return {
      actionable: Boolean(parsed.actionable),
      category: parsed.category,
      intents: [...new Set((parsed.intents ?? []).filter((intent) => VALID_INTENTS.has(intent)))],
      requestedVariant: variantMatch ? variantMatch[1].toUpperCase() : null,
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
      language: String(parsed.language ?? "unknown"),
      rationale: String(parsed.rationale ?? ""),
      engine: `vertex:${this.model}`
    };
  }
}
