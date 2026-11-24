# Krishi Voice

Voice-first chilli crop advisory PWA for smallholder farmers in Andhra Pradesh and Telangana. One screen, no typing: tap the mic, speak in Telugu, Hindi or English (mixed sentences are fine), confirm what was heard, and hear a short answer built only from the knowledge base.

## Run

    npm start

Open the printed local URL. For a phone on the same Wi-Fi use HTTPS or Chrome port forwarding: the microphone and service worker need https or localhost. No dependencies; with Bun run `bun server.js`.

The server is a small Node http proxy that serves `public/` and `POST /api/extract`.

## API key

The browser never holds the key. Copy `.env.example` to `.env` and fill in the key, base URL and model variables listed there. The endpoint asks the model for fields and knowledge-base ids only; the server drops any id or symptom key absent from the JSON, so the model cannot add advice. Without a key, or on timeout, the app uses the local synonym matcher.

## Extend with JSON only

Crop: add the name to `crop` in `kb.json`, add an entry (id, name, localNames, symptoms, symptomKeys, nonChemicalAction, avoid, recheckDays, confidenceHints, clarify, answer), and add spoken names to `crops` in `synonyms.json`.

Language: add a language object to `langs` in `i18n.json`, a matching `ui` object (copy `ui.en`; missing keys fall back to English), that code in `tagLabels`, `stageLabels` and `weatherLabels`, then the language in `kb.json` entries and `synonyms.json`.

Synonyms: add a name key mapping to an entry id, or append words to `symptoms`, `weather`, `stages`, `districts`, `yes`, `no`, `commands` in `synonyms.json`.

Audio: put files in `public/audio/` and set `answer.<lang>.audioUrl` in `kb.json`. The file must contain the whole composed answer and is played instead of speech synthesis.

## Limits

Speech recognition needs internet; voice availability varies by phone, so the app shows the text with a banner. Reminders are localStorage plus a WhatsApp share link, not push. The first load needs the network. All advice in `kb.json` is a draft limited to non-chemical first actions and must be reviewed by a qualified agronomist before real use.
