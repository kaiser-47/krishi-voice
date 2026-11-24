'use strict';

/* ==================================================================
 * Krishi Voice - speech in and out.
 * ================================================================== */

let voicesPromise = null;

function loadVoices() {
  if (voicesPromise) return voicesPromise;
  voicesPromise = new Promise((resolve) => {
    const existing = window.speechSynthesis ? speechSynthesis.getVoices() : [];
    if (existing.length) return resolve(existing);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve(window.speechSynthesis ? speechSynthesis.getVoices() : []);
    };
    if (window.speechSynthesis) speechSynthesis.addEventListener('voiceschanged', finish, { once: true });
    setTimeout(finish, 1500);
  });
  return voicesPromise;
}

const voiceCache = new Map();

async function voiceFor(code) {
  if (voiceCache.has(code)) return voiceCache.get(code);
  const wanted = bcpFor(code).toLowerCase().replace('_', '-');
  const primary = wanted.split('-')[0];
  const voices = await loadVoices();
  const found =
    voices.find((v) => String(v.lang || '').toLowerCase().replace('_', '-') === wanted) ||
    voices.find((v) => String(v.lang || '').toLowerCase().replace('_', '-').startsWith(primary + '-')) ||
    voices.find((v) => String(v.lang || '').toLowerCase() === primary) ||
    null;
  voiceCache.set(code, found);
  return found;
}

function showVoiceBanner() {
  const banner = $('#voiceBanner');
  if (!banner) return;
  banner.textContent = '\u26a0 ' + ui('voiceMissing');
  banner.hidden = false;
}

function splitSentences(text) {
  return String(text)
    .split(/(?<=[.!?\u0964\u0965])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function speakPart(text, voice) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(ok);
    };
    const timer = setTimeout(() => finish(true), Math.max(2200, (text.length * 160) / state.rate + 1500));
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = bcpFor(state.replyLang);
    if (voice) utter.voice = voice;
    utter.rate = state.rate;
    utter.onend = () => finish(true);
    utter.onerror = (ev) => finish(ev.error === 'interrupted' || ev.error === 'canceled');
    try {
      speechSynthesis.speak(utter);
    } catch (err) {
      finish(false);
    }
  });
}

function playAudio(url) {
  return new Promise((resolve) => {
    let audio;
    try {
      audio = new Audio(url);
    } catch (err) {
      return resolve(false);
    }
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        audio.pause();
      } catch (err) {
        /* ignore */
      }
      resolve(ok);
    };
    const timer = setTimeout(() => finish(true), 20000);
    audio.onended = () => finish(true);
    audio.onerror = () => finish(false);
    audio.play().catch(() => finish(false));
  });
}

async function speak(text, opts = {}) {
  if (!text) return;
  guard();
  if (!opts.quiet) addMessage('app', text);
  setStatus('speaking');
  if (!opts.quiet && opts.remember !== false) state.lastAnswer = text;

  if (opts.audioUrl) {
    const played = await playAudio(opts.audioUrl);
    if (played) {
      setStatus('thinking');
      return;
    }
  }

  if (!('speechSynthesis' in window)) {
    showVoiceBanner();
    await sleep(900);
    setStatus('thinking');
    return;
  }

  const voice = await voiceFor(state.replyLang);
  if (!voice) {
    showVoiceBanner();
    await sleep(1100);
    setStatus('thinking');
    return;
  }

  speechSynthesis.cancel();
  for (const piece of splitSentences(text)) {
    guard();
    const ok = await speakPart(piece, voice);
    if (!ok) {
      showVoiceBanner();
      break;
    }
  }
  setStatus('thinking');
}

/* -------------------------- level meter --------------------------- */

const Meter = {
  stream: null,
  ctx: null,
  analyser: null,
  data: null,
  raf: 0,
  loudFor: 0,

  async start() {
    if (this.stream) return;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { noiseSuppression: true, echoCancellation: true, autoGainControl: true }
      });
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
      const source = this.ctx.createMediaStreamSource(this.stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      source.connect(this.analyser);
      this.data = new Uint8Array(this.analyser.fftSize);
      this.loop();
    } catch (err) {
      this.stream = null;
    }
  },

  loop() {
    if (!this.analyser) return;
    this.raf = requestAnimationFrame(() => this.loop());
    this.analyser.getByteTimeDomainData(this.data);
    let sum = 0;
    for (let i = 0; i < this.data.length; i++) {
      const v = (this.data[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / this.data.length);
    const level = Math.min(1, rms * 4.5);
    const bar = $('#meterBar');
    if (bar) bar.style.width = Math.round(level * 100) + '%';

    if (level > 0.34 && !Mic.speaking) this.loudFor += 16;
    else this.loudFor = Math.max(0, this.loudFor - 24);

    const warn = $('#noiseWarn');
    if (warn) {
      const noisy = this.loudFor > 1400;
      warn.hidden = !noisy;
      warn.textContent = noisy ? '\u26a0 ' + ui('tooNoisy') : '';
    }
  },

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.loudFor = 0;
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.analyser = null;
    const bar = $('#meterBar');
    if (bar) bar.style.width = '0%';
    const warn = $('#noiseWarn');
    if (warn) warn.hidden = true;
  }
};

const Mic = { current: null, rec: null, speaking: false };

function speechSupported() {
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

function listenOnce() {
  if (state.devQueue.length) {
    const item = state.devQueue.shift();
    setListening(true);
    return sleep(450).then(() => {
      setListening(false);
      return item;
    });
  }
  if (state.devMode) return Promise.resolve({ error: 'aborted' });

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return Promise.resolve({ error: 'unsupported' });

  return new Promise((resolve) => {
    const rec = new SR();
    rec.lang = bcpFor(state.lang);
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    let settled = false;
    let finalText = '';
    let interim = '';
    let confSum = 0;
    let confCount = 0;
    let started = false;
    let spoke = false;
    let silenceTimer = null;
    const timers = [];

    const clearAll = () => {
      timers.forEach(clearTimeout);
      clearTimeout(silenceTimer);
    };

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearAll();
      Mic.current = null;
      Mic.rec = null;
      Mic.speaking = false;
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      rec.onaudiostart = null;
      rec.onspeechstart = null;
      rec.onspeechend = null;
      try {
        rec.stop();
      } catch (err) {
        /* ignore */
      }
      Meter.stop();
      setListening(false);
      resolve(result);
    };

    const transcript = () => (finalText + ' ' + interim).replace(/\s+/g, ' ').trim();
    const confidence = () => (confCount ? confSum / confCount : null);

    Mic.current = { finish };
    Mic.rec = rec;
    Mic.speaking = false;

    const armSilence = () => {
      clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        const text = transcript();
        finish(text ? { text, confidence: confidence() } : { error: 'silence' });
      }, SILENCE_MS);
    };

    rec.onaudiostart = () => {
      started = true;
    };
    rec.onspeechstart = () => {
      spoke = true;
      Mic.speaking = true;
      armSilence();
    };
    rec.onspeechend = () => {
      Mic.speaking = false;
      armSilence();
    };
    rec.onresult = (ev) => {
      started = true;
      spoke = true;
      Mic.speaking = true;
      interim = '';
      for (let i = 0; i < ev.results.length; i++) {
        const alt = ev.results[i][0];
        if (ev.results[i].isFinal) {
          finalText += (finalText ? ' ' : '') + alt.transcript;
          const c = typeof alt.confidence === 'number' ? alt.confidence : 0;
          if (c > 0) {
            confSum += c;
            confCount += 1;
          }
        } else {
          interim += ' ' + alt.transcript;
        }
      }
      armSilence();
    };
    rec.onerror = (ev) => {
      const code = ev.error;
      if (code === 'network') finish({ error: 'network' });
      else if (code === 'not-allowed' || code === 'service-not-allowed') finish({ error: 'denied' });
      else if (code === 'aborted') finish({ error: 'aborted' });
      else finish({ error: 'silence' });
    };
    rec.onend = () => {
      const text = transcript();
      finish(text ? { text, confidence: confidence() } : { error: 'silence' });
    };

    timers.push(
      setTimeout(() => {
        if (!started) speak(t('netSlow', null, state.lang), { quiet: true, remember: false });
        else if (!spoke) finish({ error: 'silence' });
      }, 8000)
    );
    timers.push(
      setTimeout(() => {
        if (!started) finish({ error: 'network' });
      }, 20000)
    );
    timers.push(
      setTimeout(() => {
        const text = transcript();
        finish(text ? { text, confidence: confidence() } : { error: 'silence' });
      }, MAX_LISTEN_MS)
    );

    setListening(true);
    Meter.start().then(() => {
      try {
        rec.start();
      } catch (err) {
        finish({ error: 'unsupported' });
      }
    });
  });
}

async function capture(opts = {}) {
  guard();
  const result = await listenOnce();
  setStatus('thinking');
  if (result.error) return { ok: false, reason: result.error };
  const text = (result.text || '').trim();
  const words = text ? text.split(/\s+/).length : 0;
  const raw = typeof result.confidence === 'number' && result.confidence > 0 ? result.confidence : null;
  if (!text || words < (opts.minWords || 1)) return { ok: false, reason: 'unclear' };
  if (raw !== null && raw < CONF_MIN) return { ok: false, reason: 'unclear', text, confidence: raw };
  return { ok: true, text, confidence: raw };
}
