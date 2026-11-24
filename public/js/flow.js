'use strict';

/* ==================================================================
 * Krishi Voice - the conversation.
 * Every spoken advice sentence comes from data/kb.json.
 * ================================================================== */

function guard() {
  if (state.aborted) {
    const err = new Error('abort');
    err.code = 'abort';
    throw err;
  }
}

function abortAll() {
  state.aborted = true;
  state.busy = false;
  state.session += 1;
  if (Mic.current) Mic.current.finish({ error: 'aborted' });
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  Meter.stop();
  hideConfirm();
  hideFollow();
  setListening(false);
  setStatus('tapToSpeak');
}

function waitYesNo() {
  return new Promise((resolve) => {
    const box = $('#confirm');
    box.classList.add('show');
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      box.classList.remove('show');
      box.onclick = null;
      if (Mic.current) Mic.current.finish({ error: 'aborted' });
      setStatus('thinking');
      resolve(value);
    };
    box.onclick = (ev) => {
      const btn = ev.target.closest('[data-answer]');
      if (!btn) return;
      finish(btn.dataset.answer);
    };
    listenOnce().then((result) => {
      if (settled) return;
      if (result.error) return finish('unknown');
      finish(parseYesNo(result.text));
    });
  });
}

async function askYesNo(question) {
  guard();
  if (question) await speak(question);
  return waitYesNo();
}

function waitForFollow() {
  return new Promise((resolve) => {
    const box = $('#follow');
    box.classList.add('show');
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      box.classList.remove('show');
      box.onclick = null;
      if (Mic.current) Mic.current.finish({ error: 'aborted' });
      resolve(value);
    };
    box.onclick = (ev) => {
      const btn = ev.target.closest('[data-cmd]');
      if (!btn) return;
      finish({ cmd: btn.dataset.cmd });
    };
    listenOnce().then((result) => {
      if (settled) return;
      if (result.error) return finish(null);
      const text = (result.text || '').trim();
      const cmd = parseCommand(text);
      finish(cmd ? { cmd } : { text });
    });
  });
}

async function startSession(textHint, tagHint) {
  if (state.busy) abortAll();
  state.aborted = false;
  state.busy = true;
  state.depth = 0;
  const sid = ++state.session;
  hideConfirm();
  hideFollow();
  clearResult();
  const banner = $('#voiceBanner');
  if (banner) banner.hidden = true;
  hideReview();

  try {
    if (!state.greeted) {
      state.replyLang = state.lang;
      await speak(t('greet'));
      state.greeted = true;
    }
    if (textHint) {
      await handleProblem(textHint, tagHint, 0);
    } else {
      state.replyLang = state.lang;
      const text = await askForProblem({ minWords: 3 });
      if (text) await handleProblem(text, null, 0);
    }
  } catch (err) {
    if (!err || err.code !== 'abort') console.error(err);
  } finally {
    if (state.session === sid) {
      state.busy = false;
      hideConfirm();
      hideFollow();
      if (!state.aborted) setStatus('tapToSpeak');
    }
  }
}

async function askForProblem(opts = {}) {
  if (!state.devMode && !speechSupported()) {
    await speak(t('noSpeechSupport'));
    showCards(true);
    return null;
  }
  if (!state.devMode && !navigator.onLine) {
    await speak(t('offlineNote'));
    showCards(true);
    return null;
  }
  const result = await capture({ minWords: opts.minWords || 1 });
  if (result.ok) return result.text;

  const reason = result.reason;
  if (reason === 'aborted') return null;
  if (reason === 'denied') await speak(t('micDenied'));
  else if (reason === 'network') await speak(t('netFail'));
  else if (reason === 'silence') await speak(t('nothingHeard'));
  else if (reason === 'unsupported') await speak(t('noSpeechSupport'));
  else await speak(t('clear'));

  showCards(true);
  logEvent({ event: 'capture_failed', reason, success: false });
  return null;
}

function summarise(analysis) {
  const parts = [pickLocalised(KB.crop)];
  analysis.tags
    .filter((key) => key !== 'rain')
    .slice(0, 4)
    .forEach((key) => parts.push(tagLabel(key)));
  if (analysis.weather) parts.push(weatherLabel(analysis.weather));
  if (analysis.stage) parts.push(stageLabel(analysis.stage));
  if (analysis.district) parts.push(analysis.district);
  return parts.join(', ');
}

function readbackText(analysis) {
  return t('heardPrefix') + ' ' + summarise(analysis) + '. ' + t('confirmQuestion');
}

async function handleProblem(text, tagHint, depth) {
  state.depth = depth || 0;
  if (state.depth > 4) {
    setStatus('tapToSpeak');
    return;
  }
  state.replyLang = detectLang(text);
  state.lastTranscript = text;
  hideCards();
  hideReview();
  clearResult();
  addMessage('you', text);

  let analysis = await analyse(text, tagHint);
  renderTags(analysis);
  logEvent({
    event: 'extracted',
    transcript: text,
    lang: state.replyLang,
    tags: analysis.tags,
    source: analysis.source,
    success: true
  });

  let noCount = 0;
  for (;;) {
    guard();
    let answer = await askYesNo(readbackText(analysis));
    if (answer === 'unknown') {
      answer = await askYesNo(t('confirmAgain'));
    }
    if (answer === 'yes') break;

    noCount += 1;
    if (noCount >= 2) return simpleMode();

    await speak(t('sorry'));
    const again = await askForProblem({ minWords: 3 });
    if (!again) return;
    state.replyLang = detectLang(again);
    addMessage('you', again);
    analysis = await analyse(again);
    renderTags(analysis);
    logEvent({ event: 'retry', transcript: again, retries: noCount, success: true });
  }

  await answerWith(analysis, depth || 0);
}

async function simpleMode() {
  await speak(t('simpleCrop'));
  const crop = await askForProblem({ minWords: 1 });
  await speak(t('simpleProblem'));
  showCards(true);
  const problem = await askForProblem({ minWords: 1 });
  const combined = [crop, problem].filter(Boolean).join(' ').trim();
  if (!combined) return;
  state.replyLang = detectLang(combined);
  addMessage('you', combined);
  const analysis = await analyse(combined, null);
  renderTags(analysis);
  logEvent({ event: 'simple_mode', transcript: combined, tags: analysis.tags, success: true });
  await answerWith(analysis, 1);
}

async function answerWith(analysis, depth) {
  let asked = 0;

  while (asked < MAX_CLARIFY) {
    guard();
    const ranked = rank(analysis);
    analysis.ranked = ranked;
    const top = ranked[0];
    if (!top || top.confidence < MATCH_MIN) break;
    const second = ranked[1];
    const gap = second ? top.confidence - second.confidence : 1;
    if (gap >= CLARIFY_GAP) break;

    const target = ranked
      .slice(0, 2)
      .map((row) => row.entry)
      .find(
        (entry) =>
          entry.clarify &&
          !analysis.askedClarify.has(entry.id) &&
          !(entry.clarify.tags || []).every((tag) => analysis.tags.includes(tag))
      );
    if (!target) break;

    analysis.askedClarify.add(target.id);
    asked += 1;
    const answer = await askYesNo(pickLocalised(target.clarify.question));
    if (answer === 'yes') {
      (target.clarify.tags || []).forEach((tag) => {
        if (!analysis.tags.includes(tag)) analysis.tags.push(tag);
      });
    } else {
      analysis.demoted.add(target.id);
    }
    logEvent({ event: 'clarify', entry: target.id, answer, retries: asked, success: true });
    renderTags(analysis);
  }

  const ranked = rank(analysis);
  analysis.ranked = ranked;
  const top = ranked[0];

  if (!top || top.confidence < MATCH_MIN) {
    return unknownPath();
  }

  const confidence = Number(top.confidence.toFixed(2));
  state.lastMatch = { id: top.entry.id, name: pickLocalised(top.entry.name), confidence, source: top.source };
  const answer = buildAnswer(top.entry, top.confidence);
  await speak(answer.text, { audioUrl: answer.audioUrl });
  renderResult(top.entry, confidence);
  logEvent({
    event: 'answer',
    matched: top.entry.id,
    confidence,
    lang: state.replyLang,
    source: top.source,
    success: true
  });

  await reminderOffer(top.entry);
  await followUp(depth || 0);
}

function buildAnswer(entry, confidence) {
  const lang = state.replyLang;
  const templates = (entry.answer && (entry.answer[lang] || entry.answer.en)) || {};
  const problem = pickLocalised(entry.name, lang);
  const opener =
    confidence >= 0.75 ? templates.likely || templates.unsure || '' : templates.unsure || templates.likely || '';

  const parts = [
    opener.replace(/\{problem\}/g, problem),
    t('actionPrefix') + ' ' + pickLocalised(entry.nonChemicalAction, lang),
    t('avoidPrefix') + ' ' + pickLocalised(entry.avoid, lang),
    t('checkPrefix', { days: entry.recheckDays }, lang)
  ].filter(Boolean);

  return { text: parts.join(' '), audioUrl: templates.audioUrl || null };
}

async function unknownPath() {
  showReview();
  state.lastMatch = null;
  await speak(t('unknownAdvice'));
  logEvent({ event: 'no_match', success: false, reason: 'below_threshold' });
  await followUp(0);
}

async function reminderOffer(entry) {
  const days = entry.recheckDays || 3;
  const answer = await askYesNo(t('remindAsk', { days }));
  if (answer === 'yes') {
    saveReminder(entry);
    await speak(t('reminderSaved'));
  }
}

async function followUp(depth) {
  await speak(t('followUp'));
  for (;;) {
    guard();
    const result = await waitForFollow();
    if (!result) return;
    if (result.cmd === 'repeat') {
      await speak(state.lastAnswer, { remember: false });
      continue;
    }
    if (result.cmd === 'slower') {
      state.rate = 0.8;
      await speak(state.lastAnswer, { remember: false });
      continue;
    }
    if (result.cmd === 'new') {
      state.rate = 1;
      const text = await askForProblem({ minWords: 3 });
      if (text) {
        state.replyLang = detectLang(text);
        await handleProblem(text, null, depth + 1);
      }
      return;
    }
    if (result.text) {
      state.rate = 1;
      await handleProblem(result.text, null, depth + 1);
    }
    return;
  }
}
