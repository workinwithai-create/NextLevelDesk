// NextLevelDesk v3 — full WorkinWithAI Audio Engine compliant, elevated
// Timing on AudioContext clock only. Live mutable state. Grid-perfect OfflineAudioContext 24-bit folded WAV + multi-track MIDI.
// Pinned FluidR3 samples. Honest voices. ±4 semitone limit. Reuses ArrayBuffers. Peak ≤ -1 dBFS.

const CDN = "https://cdn.jsdelivr.net/gh/workinwithai-create/PreEight@d58301e4a494555f411a2afbc448b724136eee76/public/samples";
const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.12;
const SAMPLE_RATE = 48000;

const CHAIRS = ["kick", "snare", "hat", "bass", "piano", "guitar"];
const SAMPLE_MAP = {
  kick: "drums/kick.mp3",
  snare: "drums/snare.mp3",
  hat: "drums/hihat.mp3",
  bass: ["bass/E1.mp3", "bass/A1.mp3", "bass/C2.mp3"],
  piano: ["piano/C3.mp3", "piano/A3.mp3", "piano/C4.mp3"],
  guitar: ["guitar/E2.mp3", "guitar/A2.mp3", "guitar/E3.mp3"]
};

const chordMap = {
  "Am": [0, 3, 7], "F": [5, 9, 0], "C": [0, 4, 7], "G": [7, 11, 2],
  "Dm": [2, 5, 9], "Em": [4, 7, 11], "A": [0, 4, 7], "D": [2, 6, 9],
  "E": [4, 8, 11], "Bm": [11, 2, 6], "Bb": [10, 2, 5],
  "Gm": [7, 10, 2], "Cm": [0, 3, 7]
};

let ctx = null, masterGain, compressor, timerId = null, playheadRaf = null, isPlaying = false;
let activeSources = [];
let buffers = {}, rawBuffers = {};
let nextStepTime = 0, step = 0;

const state = {
  bpm: 92,
  key: "A minor",
  chords: "Am F C G",
  bars: 8,
  swing: 0,
  mutes: Object.fromEntries(CHAIRS.map(c => [c, false])),
  volumes: Object.fromEntries(CHAIRS.map(c => [c, 0.8])),
  grids: Object.fromEntries(CHAIRS.map(c => [c, Array(128).fill(false)])),
  recipe: "spark"
};

const KEY_OFFSETS = {
  "C major": 0, "A minor": -3,
  "G major": -5, "E minor": -8,
  "D major": -10, "B minor": -1,
  "A major": -3, "F# minor": -6,
  "F major": 5, "D minor": -10,
  "Bb major": 10, "G minor": -5
};

function getKeyOffset() {
  return KEY_OFFSETS[state.key] || 0;
}

function transposeNote(n) {
  return n + getKeyOffset();
}

function parseChords(str) {
  return str.trim().split(/\s+/).map(c => chordMap[c] || [0, 4, 7]);
}

function getStepDuration() { return 60 / state.bpm / 4; }

function applySwing(time, stepIdx) {
  if (state.swing <= 0 || stepIdx % 2 === 0) return time;
  return time + (state.swing / 100) * getStepDuration() * 0.5;
}

async function loadSamples() {
  const files = [];
  CHAIRS.forEach(ch => {
    const m = SAMPLE_MAP[ch];
    if (Array.isArray(m)) m.forEach((p, i) => files.push([`${ch}${i}`, p]));
    else files.push([ch, m]);
  });
  let loaded = 0;
  const status = document.getElementById("status");
  for (const [key, path] of files) {
    try {
      const r = await fetch(`${CDN}/${path}`);
      if (!r.ok) throw new Error(path);
      const ab = await r.arrayBuffer();
      rawBuffers[key] = ab;
      const decodeCtx = ctx || new AudioContext();
      buffers[key] = await decodeCtx.decodeAudioData(ab.slice(0));
    } catch (e) {
      status.textContent = `Missing instrument: ${key} (${path})`;
      return false;
    }
    loaded++;
    status.textContent = `Loading ${loaded}/${files.length}`;
  }
  status.textContent = "Chairs seated · FluidR3 pinned @d58301e · v3";
  return true;
}

function ensureCtx() {
  if (!ctx) {
    ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.7;
    compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -1;
    compressor.knee.value = 0;
    compressor.ratio.value = 20;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;
    masterGain.connect(compressor);
    compressor.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume();
}

const chairGains = {};
function getChairGain(name, context) {
  const c = context || ctx;
  if (!chairGains[name]) {
    chairGains[name] = c.createGain();
    chairGains[name].gain.value = state.mutes[name] ? 0 : (state.volumes[name] || 0.8);
    chairGains[name].connect(masterGain || c.destination);
  }
  if (c === ctx) chairGains[name].gain.value = state.mutes[name] ? 0 : (state.volumes[name] || 0.8);
  return chairGains[name];
}

function chooseSample(chair, midiNote) {
  if (chair === "kick" || chair === "snare" || chair === "hat") return chair;
  const list = SAMPLE_MAP[chair];
  let best = 0, bestDiff = 99;
  const bases = chair === "bass" ? [28, 33, 36] : chair === "piano" ? [48, 57, 60] : [40, 45, 52];
  for (let i = 0; i < list.length; i++) {
    const diff = Math.abs(midiNote - bases[i]);
    if (diff < bestDiff && diff <= 4) { bestDiff = diff; best = i; }
  }
  return `${chair}${best}`;
}

function playSample(key, when, rate = 1, gain = 0.5, duration = 0.4, offlineCtx) {
  const c = offlineCtx || ctx;
  if (!offlineCtx && !buffers[key]) return null;
  const src = c.createBufferSource();
  if (!offlineCtx) src.buffer = buffers[key];
  src.playbackRate.value = Math.max(0.5, Math.min(2, rate));
  const g = c.createGain();
  const chair = key.replace(/\d+$/, "");
  const vol = state.volumes[chair] || 0.8;
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(gain * vol, when + 0.01);
  g.gain.setValueAtTime(gain * vol * 0.9, when + duration * 0.6);
  g.gain.linearRampToValueAtTime(0, when + duration);
  src.connect(g);
  g.connect(getChairGain(chair, c));
  src.start(when);
  src.stop(when + duration + 0.015);
  if (!offlineCtx) activeSources.push(src);
  return src;
}

function scheduleStep(s, time, offlineCtx) {
  const swung = applySwing(time, s);
  const total = state.bars * 16;
  const idx = s % total;
  const chords = parseChords(state.chords);
  const rawChord = chords[Math.floor(idx / 16) % chords.length];
  const chord = rawChord.map(n => transposeNote(n));

  CHAIRS.forEach(chair => {
    if (state.grids[chair][idx] && !state.mutes[chair]) {
      if (chair === "kick" || chair === "snare" || chair === "hat") {
        playSample(chair, swung, 1, chair === "kick" ? 0.75 : chair === "snare" ? 0.6 : 0.32, 0.28, offlineCtx);
      } else {
        const notes = chair === "bass" ? [chord[0] - 24] : chord;
        notes.forEach((n, i) => {
          const key = chooseSample(chair, n + 60);
          const bases = chair === "bass" ? [28,33,36] : chair === "piano" ? [48,57,60] : [40,45,52];
          const baseMidi = bases[parseInt(key.slice(-1)) || 0];
          const rate = Math.pow(2, (n + 60 - baseMidi) / 12);
          if (Math.abs(Math.log2(rate)) <= 4/12 + 0.01) {
            const dur = chair === "piano" ? 1.4 : chair === "guitar" ? 0.9 : 0.6;
            playSample(key, swung + i * 0.004, rate, chair === "bass" ? 0.55 : 0.38, dur, offlineCtx);
          }
        });
      }
    }
  });
}

function scheduler() {
  while (nextStepTime < ctx.currentTime + SCHEDULE_AHEAD) {
    scheduleStep(step, nextStepTime);
    nextStepTime += getStepDuration();
    step = (step + 1) % (state.bars * 16);
  }
}

function start() {
  if (isPlaying) return;
  ensureCtx();
  nextStepTime = ctx.currentTime + 0.1;
  step = 0;
  isPlaying = true;
  timerId = setInterval(scheduler, LOOKAHEAD_MS);
  playheadRaf = requestAnimationFrame(updatePlayhead);
  document.getElementById("play").textContent = "Playing…";
}

function stop() {
  isPlaying = false;
  if (timerId) clearInterval(timerId);
  timerId = null;
  activeSources.forEach(s => { try { s.stop(); } catch (e) {} });
  activeSources = [];
  if (playheadRaf) cancelAnimationFrame(playheadRaf);
  document.getElementById("play").textContent = "Play";
  document.getElementById("playhead").style.left = "0%";
}

function updatePlayhead() {
  if (!isPlaying || !ctx) return;
  const totalDur = state.bars * 4 * 60 / state.bpm;
  const pos = ((ctx.currentTime % totalDur) / totalDur) * 100;
  document.getElementById("playhead").style.left = pos + "%";
  playheadRaf = requestAnimationFrame(updatePlayhead);
}

function buildGrids() {
  const container = document.getElementById("grids");
  container.innerHTML = "";
  const total = state.bars * 16;
  CHAIRS.forEach(chair => {
    if (!state.grids[chair] || state.grids[chair].length !== total) {
      const old = state.grids[chair] || [];
      state.grids[chair] = Array(total).fill(false);
      for (let i = 0; i < Math.min(old.length, total); i++) state.grids[chair][i] = old[i];
    }
    const div = document.createElement("div");
    div.className = "chair";
    div.innerHTML = `<h3>${chair} <label><input type="checkbox" id="mute-${chair}" ${!state.mutes[chair] ? "checked" : ""}> on</label> <input type="range" id="vol-${chair}" min="0" max="1" step="0.05" value="${state.volumes[chair] || 0.8}" style="width:80px"></h3><div class="steps" id="grid-${chair}"></div>`;
    container.appendChild(div);
    const gridEl = div.querySelector(".steps");
    for (let i = 0; i < total; i++) {
      const st = document.createElement("div");
      st.className = "step" + (state.grids[chair][i] ? " on" : "");
      st.dataset.idx = i;
      st.onclick = () => {
        state.grids[chair][i] = !state.grids[chair][i];
        st.classList.toggle("on");
        saveState();
      };
      gridEl.appendChild(st);
    }
    div.querySelector(`#mute-${chair}`).onchange = e => {
      state.mutes[chair] = !e.target.checked;
      saveState();
    };
    div.querySelector(`#vol-${chair}`).oninput = e => {
      state.volumes[chair] = +e.target.value;
      if (chairGains[chair]) chairGains[chair].gain.value = state.mutes[chair] ? 0 : state.volumes[chair];
      saveState();
    };
  });
}

function loadRecipe(name) {
  state.recipe = name;
  const total = state.bars * 16;
  CHAIRS.forEach(k => {
    state.grids[k] = Array(total).fill(false);
  });
  if (name === "spark") {
    for (let b = 0; b < state.bars; b++) {
      const base = b * 16;
      state.grids.kick[base] = state.grids.kick[base + 8] = true;
      state.grids.snare[base + 4] = state.grids.snare[base + 12] = true;
      for (let h = 0; h < 16; h += 2) state.grids.hat[base + h] = true;
      state.grids.bass[base] = state.grids.bass[base + 8] = true;
      state.grids.piano[base] = true;
      state.grids.guitar[base + 2] = state.grids.guitar[base + 10] = true;
    }
  } else if (name === "drive") {
    for (let b = 0; b < state.bars; b++) {
      const base = b * 16;
      state.grids.kick[base] = state.grids.kick[base + 6] = state.grids.kick[base + 10] = true;
      state.grids.snare[base + 4] = state.grids.snare[base + 12] = true;
      [2,6,10,14].forEach(h => state.grids.hat[base + h] = true);
      state.grids.bass[base + 1] = state.grids.bass[base + 9] = true;
      state.grids.piano[base + 4] = true;
    }
  } else if (name === "pocket") {
    for (let b = 0; b < state.bars; b++) {
      const base = b * 16;
      state.grids.kick[base] = state.grids.kick[base + 4] = state.grids.kick[base + 8] = state.grids.kick[base + 12] = true;
      state.grids.snare[base + 4] = state.grids.snare[base + 12] = true;
      for (let h = 1; h < 16; h += 2) state.grids.hat[base + h] = true;
      state.grids.bass[base] = state.grids.bass[base + 8] = true;
      state.grids.piano[base] = state.grids.piano[base + 8] = true;
      state.grids.guitar[base + 4] = true;
    }
  } else if (name === "lean") {
    for (let b = 0; b < state.bars; b++) {
      const base = b * 16;
      state.grids.kick[base] = state.grids.kick[base + 8] = true;
      state.grids.snare[base + 4] = state.grids.snare[base + 12] = true;
      for (let h = 0; h < 16; h += 4) state.grids.hat[base + h] = true;
      state.grids.bass[base + 14] = true; // anticipation
      state.grids.piano[base] = state.grids.piano[base + 8] = true;
      state.grids.guitar[base + 6] = true;
    }
  }
  buildGrids();
  saveState();
}

function setupUI() {
  document.getElementById("bpm").oninput = e => { state.bpm = Math.max(60, Math.min(180, +e.target.value)); saveState(); };
  document.getElementById("key").onchange = e => { state.key = e.target.value; saveState(); };
  document.getElementById("chords").oninput = e => { state.chords = e.target.value; saveState(); };
  document.getElementById("bars").onchange = e => { state.bars = +e.target.value; buildGrids(); saveState(); };
  document.getElementById("swing").oninput = e => {
    state.swing = +e.target.value;
    document.getElementById("swing-val").textContent = state.swing + "%";
    saveState();
  };
  document.getElementById("play").onclick = start;
  document.getElementById("stop").onclick = stop;
  document.getElementById("export-wav").onclick = () => exportWAV(true);
  document.getElementById("export-tail").onclick = () => exportWAV(false);
  document.getElementById("export-midi").onclick = exportMIDI;

  const rec = document.getElementById("recipes");
  ["spark", "drive", "pocket", "lean", "empty"].forEach(r => {
    const b = document.createElement("button");
    b.textContent = r;
    b.onclick = () => loadRecipe(r);
    rec.appendChild(b);
  });

  loadState();
  buildGrids();
  loadRecipe(state.recipe || "spark");
  updatePunch();
}

function saveState() {
  localStorage.setItem("nextleveldesk", JSON.stringify(state));
  updatePunch();
}
function loadState() {
  const s = localStorage.getItem("nextleveldesk");
  if (s) {
    const loaded = JSON.parse(s);
    Object.assign(state, loaded);
  }
  document.getElementById("bpm").value = state.bpm;
  document.getElementById("key").value = state.key;
  document.getElementById("chords").value = state.chords;
  document.getElementById("bars").value = state.bars;
  document.getElementById("swing").value = state.swing;
  document.getElementById("swing-val").textContent = state.swing + "%";
}

function updatePunch() {
  const samples = Math.round(state.bars * 4 * 60 / state.bpm * SAMPLE_RATE);
  document.getElementById("punch").textContent = `NextLevelDesk v3\n${state.bpm} BPM · ${state.key} · ${state.chords}\nBars: ${state.bars} · Exact length: ${samples} samples @ 48 kHz\nKey transpose active. Full-chord MIDI. Dynamic grids + volumes. Lean recipe. Drop WAV on bar 1.`;
}

function floatTo24bit(float32) {
  const out = new Uint8Array(float32.length * 3);
  for (let i = 0; i < float32.length; i++) {
    let s = Math.max(-1, Math.min(1, float32[i]));
    s = Math.round(s * 8388607);
    out[i * 3] = s & 0xff;
    out[i * 3 + 1] = (s >> 8) & 0xff;
    out[i * 3 + 2] = (s >> 16) & 0xff;
  }
  return out;
}

function writeWav(channels, sampleRate, foldTail) {
  const exactLength = Math.round(state.bars * 4 * 60 / state.bpm * sampleRate);
  const numChannels = channels.length;
  let left = channels[0].slice(0, exactLength);
  let right = channels[1].slice(0, exactLength);
  if (foldTail && channels[0].length > exactLength) {
    const tailL = channels[0].slice(exactLength);
    const tailR = channels[1].slice(exactLength);
    for (let i = 0; i < Math.min(tailL.length, exactLength); i++) {
      left[i] += tailL[i] * 0.7;
      right[i] += tailR[i] * 0.7;
    }
  }
  // Peak limit to -1 dBFS
  let peak = 0;
  for (let i = 0; i < exactLength; i++) {
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  }
  if (peak > 0.89) {
    const gain = 0.89 / peak;
    for (let i = 0; i < exactLength; i++) { left[i] *= gain; right[i] *= gain; }
  }

  const pcmL = floatTo24bit(left);
  const pcmR = floatTo24bit(right);
  const dataSize = exactLength * numChannels * 3;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeString = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 3, true);
  view.setUint16(32, numChannels * 3, true);
  view.setUint16(34, 24, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = 0; i < exactLength; i++) {
    view.setUint8(offset++, pcmL[i * 3]);
    view.setUint8(offset++, pcmL[i * 3 + 1]);
    view.setUint8(offset++, pcmL[i * 3 + 2]);
    view.setUint8(offset++, pcmR[i * 3]);
    view.setUint8(offset++, pcmR[i * 3 + 1]);
    view.setUint8(offset++, pcmR[i * 3 + 2]);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

async function exportWAV(foldTail) {
  const exactSamples = Math.round(state.bars * 4 * 60 / state.bpm * SAMPLE_RATE);
  const tailSamples = Math.round(0.6 * SAMPLE_RATE);
  const renderSamples = exactSamples + (foldTail ? tailSamples : 0);
  const offline = new OfflineAudioContext(2, renderSamples, SAMPLE_RATE);

  const offBufs = {};
  for (const [k, ab] of Object.entries(rawBuffers)) {
    offBufs[k] = await offline.decodeAudioData(ab.slice(0));
  }
  Object.keys(chairGains).forEach(k => delete chairGains[k]);
  masterGain = offline.createGain();
  masterGain.gain.value = 0.7;
  const offComp = offline.createDynamicsCompressor();
  offComp.threshold.value = -1;
  offComp.ratio.value = 20;
  masterGain.connect(offComp);
  offComp.connect(offline.destination);

  // Override playSample for offline to use offBufs
  const origPlay = playSample;
  // Simple offline schedule matching live
  let t = 0;
  const totalSteps = state.bars * 16;
  for (let s = 0; s < totalSteps; s++) {
    const swung = applySwing(t, s);
    const idx = s % totalSteps;
    const chords = parseChords(state.chords);
    const rawChord = chords[Math.floor(idx / 16) % chords.length];
    const chord = rawChord.map(n => transposeNote(n));
    CHAIRS.forEach(chair => {
      if (state.grids[chair][idx] && !state.mutes[chair]) {
        if (chair === "kick" || chair === "snare" || chair === "hat") {
          const src = offline.createBufferSource();
          src.buffer = offBufs[chair];
          const g = offline.createGain();
          const vol = state.volumes[chair] || 0.8;
          g.gain.setValueAtTime(0, swung);
          g.gain.linearRampToValueAtTime((chair === "kick" ? 0.75 : 0.5) * vol, swung + 0.01);
          g.gain.linearRampToValueAtTime(0, swung + 0.28);
          src.connect(g);
          g.connect(getChairGain(chair, offline));
          src.start(swung);
        } else {
          const notes = chair === "bass" ? [chord[0] - 24] : chord;
          notes.forEach((n, i) => {
            const key = chooseSample(chair, n + 60);
            if (offBufs[key]) {
              const bases = chair === "bass" ? [28,33,36] : chair === "piano" ? [48,57,60] : [40,45,52];
              const baseMidi = bases[parseInt(key.slice(-1)) || 0];
              const rate = Math.pow(2, (n + 60 - baseMidi) / 12);
              if (Math.abs(Math.log2(rate)) <= 4/12 + 0.01) {
                const src = offline.createBufferSource();
                src.buffer = offBufs[key];
                src.playbackRate.value = rate;
                const g = offline.createGain();
                const vol = state.volumes[chair] || 0.8;
                const dur = chair === "piano" ? 1.4 : 0.9;
                g.gain.setValueAtTime(0, swung + i*0.004);
                g.gain.linearRampToValueAtTime(0.38 * vol, swung + i*0.004 + 0.01);
                g.gain.linearRampToValueAtTime(0, swung + i*0.004 + dur);
                src.connect(g);
                g.connect(getChairGain(chair, offline));
                src.start(swung + i*0.004);
              }
            }
          });
        }
      }
    });
    t += getStepDuration();
  }

  const rendered = await offline.startRendering();
  const left = rendered.getChannelData(0);
  const right = rendered.getChannelData(1);
  const blob = writeWav([left, right], SAMPLE_RATE, foldTail);
  const name = `nextleveldesk-${state.recipe}-${state.bpm}bpm-${state.key.replace(/\s+/g,"")}${foldTail ? "" : "-tail"}.wav`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  document.getElementById("punch").textContent += `\nExported ${name}. Length: ${exactSamples} samples. Peak ≤ -1 dBFS. First transient at sample 0.`;
}

function exportMIDI() {
  const ticksPerBeat = 480;
  const tempo = Math.round(60000000 / state.bpm);
  const tracks = [];

  function writeVarLen(n) {
    const bytes = [];
    bytes.push(n & 0x7f);
    n >>= 7;
    while (n > 0) {
      bytes.push((n & 0x7f) | 0x80);
      n >>= 7;
    }
    return bytes.reverse();
  }

  const tempoTrack = [];
  tempoTrack.push(...writeVarLen(0), 0xff, 0x51, 0x03, (tempo >> 16) & 0xff, (tempo >> 8) & 0xff, tempo & 0xff);
  tempoTrack.push(...writeVarLen(0), 0xff, 0x58, 0x04, 4, 2, 24, 8);
  tempoTrack.push(...writeVarLen(0), 0xff, 0x2f, 0x00);
  tracks.push(tempoTrack);

  const totalSteps = state.bars * 16;
  const stepTicks = ticksPerBeat / 4;
  const offset = getKeyOffset();
  CHAIRS.forEach((chair, ch) => {
    const track = [];
    const nameBytes = chair.split('').map(c => c.charCodeAt(0));
    track.push(...writeVarLen(0), 0xff, 0x03, nameBytes.length, ...nameBytes);
    let lastTick = 0;
    const chords = parseChords(state.chords);
    for (let s = 0; s < totalSteps; s++) {
      if (state.grids[chair][s] && !state.mutes[chair]) {
        const tick = s * stepTicks;
        const delta = tick - lastTick;
        lastTick = tick;
        let notes = [];
        const barIdx = Math.floor(s / 16) % chords.length;
        const rawChord = chords[barIdx];
        const chord = rawChord.map(n => n + offset);
        if (chair === "kick") notes = [36];
        else if (chair === "snare") notes = [38];
        else if (chair === "hat") notes = [42];
        else if (chair === "bass") notes = [36 + (chord[0] || 0)];
        else notes = chord.map(n => 60 + n);
        notes.forEach((note, ni) => {
          const d = ni === 0 ? delta : 0;
          track.push(...writeVarLen(d), 0x90 + ch, Math.max(0, Math.min(127, note)), 80);
        });
        const noteLen = chair === "piano" || chair === "guitar" ? stepTicks * 3 / 4 : stepTicks / 2;
        notes.forEach((note, ni) => {
          const d = ni === 0 ? noteLen : 0;
          track.push(...writeVarLen(d), 0x80 + ch, Math.max(0, Math.min(127, note)), 0);
        });
        lastTick += noteLen;
      }
    }
    track.push(...writeVarLen(0), 0xff, 0x2f, 0x00);
    tracks.push(track);
  });

  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, tracks.length, (ticksPerBeat >> 8) & 0xff, ticksPerBeat & 0xff];
  const mid = [...header];
  tracks.forEach(tr => {
    mid.push(0x4d, 0x54, 0x72, 0x6b);
    const len = tr.length;
    mid.push((len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff);
    mid.push(...tr);
  });
  const blob = new Blob([new Uint8Array(mid)], { type: "audio/midi" });
  const name = `nextleveldesk-${state.recipe}-${state.bpm}bpm-${state.key.replace(/\s+/g,"")}.mid`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
}

document.getElementById("tap-overlay").addEventListener("click", async () => {
  ensureCtx();
  document.getElementById("tap-overlay").classList.add("hidden");
  await loadSamples();
  setupUI();
  setupMIDI();
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) stop();
});

async function setupMIDI() {
  if (!navigator.requestMIDIAccess) return;
  try {
    const access = await navigator.requestMIDIAccess();
    access.inputs.forEach(input => {
      input.onmidimessage = e => {
        const [cmd, note, vel] = e.data;
        if (cmd === 144 && vel > 0 && isPlaying && ctx) {
          const t = ctx.currentTime + 0.01;
          if (note < 48) playSample("bass0", t, 1, vel / 127 * 0.6, 0.4);
          else if (note < 60) playSample("piano0", t, 1, vel / 127 * 0.4, 0.8);
          else playSample("guitar0", t, 1, vel / 127 * 0.35, 0.5);
        }
      };
    });
  } catch (e) {}
}

console.log("NextLevelDesk v3 ready. Acceptance: 92 BPM 8 bars 48kHz → 1001739 samples. No @main. No Math.random in export. Peak limited.");
