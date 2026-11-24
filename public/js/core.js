'use strict';

/* ==================================================================
 * Krishi Voice - core: constants, state, i18n, data loading.
 * Loaded first; later scripts add speech, matching, UI and the flow.
 * ================================================================== */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const CONF_MIN = 0.6;
const MATCH_MIN = 0.55;
const SILENCE_MS = 2000;
const MAX_LISTEN_MS = 30000;
const MAX_CLARIFY = 3;
const CLARIFY_GAP = 0.2;

const LS_REMINDERS = 'krishi.reminders';
const LS_ANALYTICS = 'krishi.analytics';

let I18N = null;
let KB = null;
let SYN = null;

const state = {
  lang: 'te',
  replyLang: 'te',
  rate: 1,
  greeted: false,
  session: 0,
  aborted: false,
  busy: false,
  statusKey: 'tapToSpeak',
  lastAnswer: '',
  lastMatch: null,
  lastTranscript: '',
  devMode: false,
  devQueue: [],
  depth: 0
};

function t(key, vars, code) {
  const lang = code || state.replyLang;
  const pack = (I18N && I18N.ui && I18N.ui[lang]) || {};
  const fallback = (I18N && I18N.ui && I18N.ui.en) || {};
  let text = pack[key] != null ? pack[key] : fallback[key] != null ? fallback[key] : key;
  if (typeof text === 'string' && vars) {
    text = text.replace(/\{(\w+)\}/g, (m, name) => (vars[name] != null ? String(vars[name]) : m));
  }
  return text;
}

const ui = (key, vars) => t(key, vars, state.lang);

function pickLocalised(obj, code) {
  if (!obj) return '';
  if (typeof obj === 'string') return obj;
  return obj[code || state.replyLang] || obj.en || '';
}

function labelFrom(mapName, key, code) {
  const lang = code || state.replyLang;
  const map = I18N[mapName] || {};
  return (map[lang] && map[lang][key]) || (map.en && map.en[key]) || key;
}

const tagLabel = (key, code) => labelFrom('tagLabels', key, code);
const stageLabel = (key) => labelFrom('stageLabels', key);
const weatherLabel = (key) => labelFrom('weatherLabels', key);

function bcpFor(code) {
  const pack = (I18N.langs || []).find((l) => l.code === code);
  return (pack && pack.bcp) || 'en-IN';
}

async function loadData() {
  const [i18n, kb, syn] = await Promise.all([
    fetch('data/i18n.json').then((r) => {
      if (!r.ok) throw new Error('i18n.json');
      return r.json();
    }),
    fetch('data/kb.json').then((r) => {
      if (!r.ok) throw new Error('kb.json');
      return r.json();
    }),
    fetch('data/synonyms.json').then((r) => {
      if (!r.ok) throw new Error('synonyms.json');
      return r.json();
    })
  ]);
  I18N = i18n;
  KB = kb;
  SYN = syn;
}

async function boot() {
  setStatusText(ui('loading'));
  try {
    await loadData();
  } catch (err) {
    setStatusText('Could not load data files');
    addMessage('sys', 'Could not load data/*.json. Serve this folder with `npm start` (do not double-click index.html).');
    console.error(err);
    return;
  }

  state.lang = I18N.defaultLang || (I18N.langs[0] && I18N.langs[0].code) || 'te';
  state.replyLang = state.lang;

  renderLangButtons();
  renderChrome();
  renderReminders();
  wireEvents();
  setStatus(state.statusKey);
  registerServiceWorker();
  logEvent({ event: 'open', lang: state.lang });
}

function setStatusText(text) {
  const node = $('#status');
  if (node) node.textContent = text;
}

function setStatus(key) {
  state.statusKey = key;
  setStatusText(ui(key));
}

function setListening(on) {
  const mic = $('#mic');
  if (!mic) return;
  mic.classList.toggle('listen', on);
  mic.classList.toggle('busy', !on && state.busy);
  if (on) setStatus('listening');
}

function addMessage(role, text) {
  const log = $('#log');
  if (!log) return;
  const node = document.createElement('div');
  node.className = 'msg ' + (role === 'you' ? 'you' : role === 'sys' ? 'sys' : 'app');
  if (role !== 'sys') {
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = role === 'you' ? ui('youLabel') : ui('appLabel');
    node.appendChild(who);
  }
  node.appendChild(document.createTextNode(text));
  log.appendChild(node);
  while (log.children.length > 40) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker not registered:', err));
}

document.addEventListener('DOMContentLoaded', boot);
