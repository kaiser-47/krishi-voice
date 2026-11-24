'use strict';

/* ==================================================================
 * Krishi Voice - rendering, picture cards, reminders, analytics.
 * ================================================================== */

function renderLangButtons() {
  const box = $('#langs');
  box.innerHTML = '';
  (I18N.langs || []).forEach((lang) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.lang = lang.code;
    button.textContent = lang.label;
    button.classList.toggle('on', lang.code === state.lang);
    box.appendChild(button);
  });
}

function renderChrome() {
  document.documentElement.lang = state.lang;
  $('#appTitle').textContent = ui('appTitle');
  document.title = ui('appTitle') + ' \u2014 Chilli Advisor';
  $('#mic').setAttribute('aria-label', ui('micLabel'));
  $('#reviewBadge').textContent = '\u26a0 ' + ui('reviewBadge');
  $('#followRepeat').textContent = '\u21bb ' + ui('repeatBtn');
  $('#followNew').textContent = '\uff0b ' + ui('newBtn');
  $('#followSlower').textContent = '\ud83d\udc22 ' + ui('slowerBtn');
  $('#cardsPrompt').textContent = ui('cardsPrompt');
  const yes = $('#confirm [data-answer="yes"]');
  const no = $('#confirm [data-answer="no"]');
  if (yes) yes.setAttribute('aria-label', ui('yes'));
  if (no) no.setAttribute('aria-label', ui('no'));
  $$('#langs button').forEach((b) => b.classList.toggle('on', b.dataset.lang === state.lang));
  renderCards();
  if (!state.busy) setStatus(state.statusKey || 'tapToSpeak');
}

function renderTags(analysis) {
  const box = $('#tags');
  box.innerHTML = '';
  const chips = [];
  chips.push({ text: pickLocalised(KB.crop), muted: !analysis.crop });
  if (analysis.stage) chips.push({ text: '\ud83c\udf31 ' + stageLabel(analysis.stage) });
  analysis.tags
    .filter((key) => key !== 'rain')
    .forEach((key) => chips.push({ text: tagLabel(key) }));
  if (analysis.weather) chips.push({ text: '\ud83c\udf27 ' + weatherLabel(analysis.weather) });
  if (analysis.district) chips.push({ text: '\ud83d\udccd ' + analysis.district });

  chips.forEach((chip) => {
    const node = document.createElement('span');
    node.className = 'tag' + (chip.muted ? ' muted' : '');
    node.textContent = chip.text;
    box.appendChild(node);
  });
}

function clearResult() {
  $('#result').innerHTML = '';
  $('#tags').innerHTML = '';
}

function renderResult(entry, confidence) {
  const box = $('#result');
  box.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'card';

  const head = document.createElement('div');
  head.className = 'card-head';
  const name = document.createElement('strong');
  name.textContent = pickLocalised(entry.name);
  const conf = document.createElement('span');
  conf.className = 'conf';
  conf.textContent = ui('confidenceLabel') + ' ' + Math.round(confidence * 100) + '%';
  head.append(name, conf);

  const action = document.createElement('p');
  action.textContent = pickLocalised(entry.nonChemicalAction);

  const avoid = document.createElement('p');
  avoid.className = 'avoid';
  avoid.textContent = pickLocalised(entry.avoid);

  const check = document.createElement('p');
  check.textContent = t('checkPrefix', { days: entry.recheckDays });

  card.append(head, action, avoid, check);
  box.appendChild(card);
}

function showReview() {
  $('#reviewBadge').hidden = false;
}

function hideReview() {
  $('#reviewBadge').hidden = true;
}

function hideConfirm() {
  $('#confirm').classList.remove('show');
  $('#confirm').onclick = null;
}

function hideFollow() {
  $('#follow').classList.remove('show');
  $('#follow').onclick = null;
}

/* --------------------------- picture cards ------------------------ */

const CARD_ART = {
  curl:
    '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 6c16 10 22 26 14 38-6 9-22 11-30 2C8 36 18 18 32 6z" fill="#4f9d3a"/><path d="M33 8c4 14 2 28-6 40" stroke="#2e6b22" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M12 44c-4 5-3 10 3 12" stroke="#c62828" stroke-width="4" fill="none" stroke-linecap="round"/></svg>',
  yellow:
    '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 6c16 10 22 26 14 38-6 9-22 11-30 2C8 36 18 18 32 6z" fill="#e8b923"/><path d="M33 8c4 14 2 28-6 40" stroke="#9c7a08" stroke-width="3" fill="none" stroke-linecap="round"/></svg>',
  spots:
    '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 6c16 10 22 26 14 38-6 9-22 11-30 2C8 36 18 18 32 6z" fill="#4f9d3a"/><circle cx="26" cy="26" r="4" fill="#3a2410"/><circle cx="37" cy="34" r="5" fill="#3a2410"/><circle cx="28" cy="42" r="3.5" fill="#3a2410"/></svg>',
  hole:
    '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M20 12c8-4 20 0 24 10 4 11-2 24-14 28-10 3-18-3-18-14 0-10 2-20 8-24z" fill="#cf3a2c"/><circle cx="27" cy="30" r="6" fill="#1b2617"/><path d="M20 12c-2-4-1-7 2-8" stroke="#2e6b22" stroke-width="4" fill="none" stroke-linecap="round"/></svg>',
  white:
    '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 6c16 10 22 26 14 38-6 9-22 11-30 2C8 36 18 18 32 6z" fill="#4f9d3a"/><circle cx="24" cy="28" r="2.6" fill="#fff"/><circle cx="34" cy="24" r="2.6" fill="#fff"/><circle cx="31" cy="38" r="2.6" fill="#fff"/><circle cx="40" cy="33" r="2.6" fill="#fff"/></svg>'
};

function renderCards() {
  const box = $('#cards');
  if (!box) return;
  box.innerHTML = '';
  (KB.cards || []).forEach((card) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.cardId = card.id;
    button.innerHTML = CARD_ART[card.id] || CARD_ART.curl;
    const label = document.createElement('span');
    label.textContent = tagLabel(card.labelKey || card.id, state.lang);
    button.appendChild(label);
    box.appendChild(button);
  });
  box.dataset.tagsById = JSON.stringify(
    (KB.cards || []).reduce((acc, card) => {
      acc[card.id] = card.tags || [];
      return acc;
    }, {})
  );
}

function showCards(show) {
  const box = $('#cards');
  const prompt = $('#cardsPrompt');
  if (!box) return;
  if (show) {
    renderCards();
    box.classList.add('show');
    if (prompt) prompt.hidden = false;
  } else {
    box.classList.remove('show');
    if (prompt) prompt.hidden = true;
  }
}

function hideCards() {
  showCards(false);
}

/* ----------------------------- reminders -------------------------- */

function loadReminders() {
  try {
    const list = JSON.parse(localStorage.getItem(LS_REMINDERS) || '[]');
    return Array.isArray(list) ? list : [];
  } catch (err) {
    return [];
  }
}

function saveReminder(entry) {
  const days = entry.recheckDays || 3;
  const item = {
    id: 'r' + Date.now(),
    due: Date.now() + days * 86400000,
    lang: state.replyLang,
    text: t('reminderText', {
      days,
      crop: pickLocalised(KB.crop),
      problem: pickLocalised(entry.name)
    }),
    created: Date.now()
  };
  const list = loadReminders();
  list.push(item);
  try {
    localStorage.setItem(LS_REMINDERS, JSON.stringify(list.slice(-20)));
  } catch (err) {
    /* storage disabled */
  }
  renderReminders();
  logEvent({ event: 'reminder_saved', matched: entry.id, success: true });
}

function renderReminders() {
  const box = $('#rem');
  if (!box) return;
  box.innerHTML = '';
  const items = loadReminders()
    .filter((item) => item && item.due > Date.now() - 86400000)
    .slice(-3);

  items.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'reminder';

    const text = document.createElement('div');
    text.className = 'reminder-text';
    text.textContent = '\u23f0 ' + item.text;

    const date = document.createElement('div');
    date.className = 'reminder-date';
    const when = new Date(item.due);
    const locale = item.lang === 'hi' ? 'hi-IN' : item.lang === 'te' ? 'te-IN' : 'en-IN';
    date.textContent = ui('reminderDue') + ': ' + when.toLocaleDateString(locale, { day: 'numeric', month: 'short' });

    const share = document.createElement('a');
    share.className = 'share';
    share.target = '_blank';
    share.rel = 'noopener';
    share.href = 'https://wa.me/?text=' + encodeURIComponent(item.text + ' \u2014 ' + when.toLocaleDateString(locale));
    share.textContent = '\ud83d\udcac ' + ui('shareBtn');

    card.append(text, date, share);
    box.appendChild(card);
  });
}

/* ---------------------- analytics + dev panel --------------------- */

function readAnalytics() {
  try {
    const list = JSON.parse(localStorage.getItem(LS_ANALYTICS) || '[]');
    return Array.isArray(list) ? list : [];
  } catch (err) {
    return [];
  }
}

function logEvent(record) {
  const entry = Object.assign({ t: Date.now(), uiLang: state.lang, lang: state.replyLang }, record);
  const list = readAnalytics();
  list.push(entry);
  try {
    localStorage.setItem(LS_ANALYTICS, JSON.stringify(list.slice(-80)));
  } catch (err) {
    /* ignore */
  }
  renderDevAnalytics();
  renderDevLive();
}

function renderDevAnalytics() {
  const box = $('#devAnalytics');
  if (!box) return;
  const lines = readAnalytics()
    .slice(-15)
    .map((e) => {
      const parts = [
        new Date(e.t).toLocaleTimeString('en-IN', { hour12: false }),
        e.event,
        'lang=' + (e.lang || '?'),
        e.matched ? 'match=' + e.matched : '',
        e.confidence != null ? 'conf=' + e.confidence : '',
        e.source ? 'src=' + e.source : '',
        e.success === false ? 'FAIL' : ''
      ].filter(Boolean);
      return parts.join('  ');
    });
  box.textContent = lines.length ? lines.join('\n') : '(empty)';
}

function renderDevLive() {
  const box = $('#devLive');
  if (!box) return;
  if (!box.dataset.started) {
    box.textContent = 'Run a test input above.';
    return;
  }
  const lines = [
    'Transcript: ' + (state.lastTranscript || '\u2014'),
    'Language: ' + state.replyLang,
    'Tags: ' + ($('#tags').textContent.trim() || '\u2014'),
    'Matched entry: ' +
      (state.lastMatch
        ? state.lastMatch.id + ' (' + Math.round(state.lastMatch.confidence * 100) + '%, ' + state.lastMatch.source + ')'
        : 'none - needs human review'),
    'Review badge: ' + ($('#reviewBadge').hidden ? 'no' : 'yes')
  ];
  box.textContent = lines.join('\n');
}

function openDevPanel() {
  const panel = $('#devPanel');
  panel.hidden = !panel.hidden;
  if (!panel.hidden) {
    renderDevAnalytics();
    renderDevLive();
  }
}

/* ------------------------ developer tests ------------------------- */

const DEV_TESTS = [
  {
    name: '1 \u00b7 Clear Telugu',
    lang: 'te',
    items: [
      { text: '\u0c28\u0c3e \u0c2e\u0c3f\u0c30\u0c2a \u0c06\u0c15\u0c41\u0c32\u0c41 \u0c2a\u0c48\u0c15\u0c3f \u0c2e\u0c41\u0c21\u0c41\u0c1a\u0c41\u0c15\u0c41\u0c02\u0c1f\u0c41\u0c28\u0c4d\u0c28\u0c3e\u0c2f\u0c3f, \u0c06\u0c15\u0c41\u0c32 \u0c15\u0c3f\u0c02\u0c26 \u0c24\u0c46\u0c32\u0c4d\u0c32 \u0c2a\u0c41\u0c30\u0c41\u0c17\u0c41\u0c32\u0c41 \u0c09\u0c28\u0c4d\u0c28\u0c3e\u0c2f\u0c3f', confidence: 0.93 },
      { text: '\u0c05\u0c35\u0c41\u0c28\u0c41', confidence: 0.9 },
      { text: '\u0c15\u0c3e\u0c26\u0c41', confidence: 0.9 }
    ]
  },
  {
    name: '2 \u00b7 Noisy mixed Telugu-English',
    lang: 'te',
    items: [
      { text: 'aaku curl avutunnayi, white insects undi', confidence: 0.68 },
      { text: 'avunu', confidence: 0.8 },
      { text: 'avunu', confidence: 0.8 },
      { text: 'kaadu', confidence: 0.8 },
      { text: 'repeat', confidence: 0.8 }
    ]
  },
  {
    name: '3 \u00b7 Unknown problem (Hindi)',
    lang: 'hi',
    items: [
      { text: '\u092e\u0947\u0930\u0940 \u092e\u093f\u0930\u094d\u091a \u0915\u0940 \u092a\u0924\u094d\u0924\u093f\u092f\u093e\u0901 \u0917\u093f\u0930 \u0930\u0939\u0940 \u0939\u0948\u0902 \u0914\u0930 \u092e\u093f\u091f\u094d\u091f\u0940 \u0938\u0942\u0916 \u0930\u0939\u0940 \u0939\u0948', confidence: 0.9 },
      { text: '\u0939\u093e\u0901', confidence: 0.9 }
    ]
  }
];

function runDevTest(index) {
  const test = DEV_TESTS[index];
  if (!test) return;
  if (state.busy) abortAll();
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  state.lang = test.lang;
  state.replyLang = test.lang;
  state.greeted = true;
  state.devMode = true;
  state.devQueue = test.items.slice();
  state.busy = false;
  state.aborted = false;
  state.lastTranscript = '';
  state.lastMatch = null;
  state.rate = 1;
  $('#log').innerHTML = '';
  $('#result').innerHTML = '';
  $('#tags').innerHTML = '';
  hideCards();
  hideReview();
  $('#devLive').dataset.started = '1';
  renderChrome();
  logEvent({ event: 'dev_test', test: test.name, lang: test.lang, success: true });
  startSession();
}

function buildDevPanel() {
  const box = $('#devButtons');
  if (!box) return;
  box.innerHTML = '';
  DEV_TESTS.forEach((test, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = test.name;
    button.addEventListener('click', () => runDevTest(index));
    box.appendChild(button);
  });
}

/* ----------------------------- wiring ----------------------------- */

function wireEvents() {
  $('#mic').addEventListener('click', () => {
    if (state.busy) {
      abortAll();
      return;
    }
    state.rate = 1;
    state.replyLang = state.lang;
    startSession();
  });

  $('#langs').addEventListener('click', (ev) => {
    const button = ev.target.closest('[data-lang]');
    if (!button) return;
    const code = button.dataset.lang;
    if (!code) return;
    abortAll();
    state.lang = code;
    state.replyLang = code;
    state.greeted = false;
    state.devMode = false;
    state.devQueue = [];
    renderChrome();
    logEvent({ event: 'language', lang: code });
  });

  $('#cards').addEventListener('click', (ev) => {
    const button = ev.target.closest('[data-card-id]');
    if (!button) return;
    const id = button.dataset.cardId;
    const tags = JSON.parse($('#cards').dataset.tagsById || '{}')[id] || [];
    const card = (KB.cards || []).find((c) => c.id === id) || {};
    const label = tagLabel(card.labelKey || id, state.lang);
    hideCards();
    state.devMode = false;
    state.devQueue = [];
    startSession(label, tags);
  });

  buildDevPanel();

  $('#devLink').addEventListener('click', (ev) => {
    ev.preventDefault();
    openDevPanel();
  });

  const title = $('#title');
  let pressTimer = null;
  const cancelPress = () => clearTimeout(pressTimer);
  title.addEventListener('pointerdown', () => {
    pressTimer = setTimeout(openDevPanel, 900);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((type) => title.addEventListener(type, cancelPress));

  $('#devClear').addEventListener('click', () => {
    try {
      localStorage.removeItem(LS_ANALYTICS);
    } catch (err) {
      /* ignore */
    }
    renderDevAnalytics();
    logEvent({ event: 'analytics_cleared', success: true });
  });

  window.addEventListener('online', () => {
    const banner = $('#voiceBanner');
    if (banner) banner.hidden = true;
  });

  if ('speechSynthesis' in window) {
    speechSynthesis.addEventListener('voiceschanged', () => {
      voiceCache.clear();
      voicesPromise = null;
    });
  }
}
