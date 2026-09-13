# Wavu

Wavu turns overlooked social-media buying questions into grounded WhatsApp orders for small merchants.

## Current build

This first slice already demonstrates the complete domain workflow without external credentials:

- buying-intent classification;
- social post to catalog-product grounding;
- price and stock answers from a merchant-controlled source of truth;
- opaque `WV-XXXX` context handoffs;
- WhatsApp-style confirmation;
- inventory reservation;
- duplicate webhook and confirmation protection;
- scarce-stock protection for competing buyers;
- independent outcome assertions;
- a demo dashboard and action timeline;
- Meta webhook verification and payload parsing endpoints.

Demo adapters are clearly labeled. Real Instagram, WhatsApp, Google Sheets, Google Calendar, and TikTok adapters will be activated as credentials become available.

## Run

Requires Node.js 20 or newer. No package installation is currently required.

```powershell
npm start
```

Open `http://localhost:8787`.

## Test

```powershell
npm test
```

## HTTP surface

```text
GET  /health
GET  /api/state
GET  /api/evaluate
POST /api/reset
POST /api/demo/comment
POST /api/demo/whatsapp
GET  /webhooks/meta
POST /webhooks/meta
```

## Safety

Copy `.env.example` to `.env` only when credentials are ready. Never commit `.env`, access tokens, private keys, phone numbers, or service-account JSON files.
