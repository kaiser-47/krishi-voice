# Krishi Voice

Voice-first chilli crop advisory PWA for smallholder farmers in Andhra Pradesh and Telangana. One screen, no typing: tap the mic, speak in Telugu, Hindi or English (mixed sentences are fine), confirm what was heard, and hear a short answer built only from the knowledge base.

## Run

    npm start

Open the printed local URL. For a phone on the same Wi-Fi use HTTPS or Chrome port forwarding: the microphone and service worker need https or localhost. No dependencies; with Bun run `bun server.js`.

The server is a small Node http proxy that serves `public/` and `POST /api/extract`.

## API key

The browser never holds the key. Copy `.env.example` to `.env` and fill in the key, base URL and model variables listed there. The endpoint asks the model for fields and knowledge-base ids only; the server drops any id or symptom key absent from the JSON, so the model cannot add advice. Without a key, or on timeout, the app uses the local synonym matcher.
