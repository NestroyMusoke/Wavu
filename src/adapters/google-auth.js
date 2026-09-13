import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

export async function loadServiceAccount(filePath) {
  if (!filePath) throw new Error("GOOGLE_SERVICE_ACCOUNT_FILE is required");
  const credentials = JSON.parse(await readFile(filePath, "utf8"));
  if (!credentials.client_email || !credentials.private_key) throw new Error("Invalid Google service-account file");
  return credentials;
}

export async function getGoogleAccessToken({ credentials, scopes }) {
  if (!credentials) {
    const response = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", {
      headers: { "Metadata-Flavor": "Google" }
    });
    const result = await response.json();
    if (!response.ok) throw new Error(`Google metadata token failed: ${result.error ?? response.status}`);
    return result.access_token;
  }
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    iss: credentials.client_email,
    scope: scopes.join(" "),
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }));
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${signer.sign(credentials.private_key, "base64url")}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`Google token exchange failed: ${result.error_description ?? result.error}`);
  return result.access_token;
}
