'use strict';

/* ==================================================================
 * Krishi Voice - understanding text.
 * Local matcher (synonyms + symptom words) plus the optional LLM
 * extractor. The LLM returns ids and fields only, never advice.
 * ================================================================== */

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[.,!?;:"'`(){}[\]<>/\\|@#$%^&*_+=~\-\u0964\u0965]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function termIn(haystack, term) {
  const needle = normalize(term);
  if (!needle) return false;
  if (/^[a-z0-9 ]+$/.test(needle)) {
    const body = needle.split(' ').map(escRe).join('\\s+');
    return new RegExp('(^|\\s)' + body + '\\w*(?=\\s|$)').test(haystack);
  }
  return haystack.includes(needle);
}

function detectLang(text) {
  let te = 0;
  let hi = 0;
  let en = 0;
  for (const word of String(text).split(/\s+/)) {
    if (/[\u0C00-\u0C7F]/.test(word)) te += 1;
    else if (/[\u0900-\u097F]/.test(word)) hi += 1;
    else if (/[A-Za-z]/.test(word)) en += 1;
  }
  if (te === 0 && hi === 0) return state.lang;
  if (te >= hi && te >= en) return 'te';
  if (hi >= te && hi >= en) return 'hi';
  return 'en';
}

function parseYesNo(text) {
  const words = normalize(text).split(' ').filter(Boolean);
  const yes = (SYN.yes || []).map((w) => w.toLowerCase());
  const no = (SYN.no || []).map((w) => w.toLowerCase());
  let answer = 'unknown';
  for (const word of words) {
    if (no.includes(word)) answer = 'no';
    else if (yes.includes(word)) answer = 'yes';
  }
  return answer;
}

function parseCommand(text) {
  const hay = normalize(text);
  for (const [name, words] of Object.entries(SYN.commands || {})) {
    if ((words || []).some((w) => termIn(hay, w))) return name;
  }
  return null;
}

function localAnalyse(text, tagHint) {
  const hay = normalize(text);
  const tags = new Set(tagHint || []);
  const nameHits = new Set();

  for (const [term, id] of Object.entries(SYN.names || {})) {
    if (termIn(hay, term)) nameHits.add(id);
  }
  for (const entry of KB.entries) {
    const names = [];
    Object.values(entry.localNames || {}).forEach((list) => names.push(...(list || [])));
    names.push(...(entry.confidenceHints || []));
    if (names.some((name) => termIn(hay, name))) nameHits.add(entry.id);
  }

  for (const [key, words] of Object.entries(SYN.symptoms || {})) {
    if ((words || []).some((word) => termIn(hay, word))) tags.add(key);
  }

  let weather = null;
  for (const [key, words] of Object.entries(SYN.weather || {})) {
    if ((words || []).some((word) => termIn(hay, word))) {
      weather = key;
      break;
    }
  }

  const stage =
    Object.keys(SYN.stages || {}).find((k) => (SYN.stages[k] || []).some((w) => termIn(hay, w))) || null;
  const district =
    Object.keys(SYN.districts || {}).find((k) => (SYN.districts[k] || []).some((w) => termIn(hay, w))) || null;
  const crop = (SYN.crops || []).some((w) => termIn(hay, w)) ? 'chilli' : null;

  return { tags: Array.from(tags), nameHits: Array.from(nameHits), weather, stage, district, crop };
}

function rank(analysis) {
  const llmMatches = (analysis.llm && analysis.llm.matches) || [];
  const allowed = new Set(KB.entries.map((e) => e.id));
  const llmMap = new Map();
  for (const match of llmMatches) {
    if (!match || !allowed.has(match.id)) continue;
    const value = Number(match.confidence);
    if (Number.isFinite(value)) llmMap.set(match.id, Math.max(0, Math.min(1, value)));
  }

  return KB.entries
    .map((entry) => {
      const tagHits = (entry.symptomKeys || []).filter((k) => analysis.tags.includes(k));
      const nameHit = analysis.nameHits.includes(entry.id);
      const llmConf = llmMap.has(entry.id) ? llmMap.get(entry.id) : null;

      let confidence;
      if (nameHit && tagHits.length >= 2) confidence = 0.9;
      else if (nameHit && tagHits.length === 1) confidence = 0.8;
      else if (nameHit) confidence = 0.7;
      else if (tagHits.length >= 4) confidence = 0.8;
      else if (tagHits.length === 3) confidence = 0.7;
      else if (tagHits.length === 2) confidence = 0.6;
      else if (tagHits.length === 1) confidence = 0.4;
      else confidence = 0;

      if (llmConf !== null) confidence = Math.max(confidence, llmConf);
      if (analysis.demoted && analysis.demoted.has(entry.id)) confidence = Math.max(0, confidence - 0.25);

      return {
        entry,
        tagHits,
        score: tagHits.length * 2 + (nameHit ? 6 : 0),
        confidence,
        source: llmConf !== null ? 'llm' : 'local'
      };
    })
    .sort((a, b) => b.confidence - a.confidence || b.score - a.score);
}

async function callExtract(text) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, lang: state.lang }),
      signal: controller.signal
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data && Array.isArray(data.matches) ? data : null;
  } catch (err) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function analyse(text, tagHint) {
  const local = localAnalyse(text, tagHint);
  let llm = null;
  if (navigator.onLine) llm = await callExtract(text);

  const analysis = {
    text,
    tags: local.tags,
    nameHits: local.nameHits,
    weather: local.weather,
    stage: local.stage,
    district: local.district,
    crop: local.crop,
    llm,
    demoted: new Set(),
    askedClarify: new Set()
  };

  if (llm) {
    (llm.symptoms || []).forEach((key) => {
      if (KB.entries.some((e) => (e.symptomKeys || []).includes(key)) && !analysis.tags.includes(key)) {
        analysis.tags.push(key);
      }
    });
    if (!analysis.stage && llm.stage && llm.stage !== 'unknown') analysis.stage = llm.stage;
    if (!analysis.weather && llm.weather && llm.weather !== 'unknown') analysis.weather = llm.weather;
    if (!analysis.district && llm.district && llm.district !== 'unknown') analysis.district = llm.district;
    if (!analysis.crop && llm.crop === 'chilli') analysis.crop = 'chilli';
  }

  analysis.source = llm ? 'llm' : 'local';
  analysis.ranked = rank(analysis);
  return analysis;
}
