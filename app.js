import { reverseSamples, trimSilence, PlaybackClock, createHallEffect, createDistortionEffect } from './audio.js';

const $ = (id) => document.getElementById(id);
const recordButton = $('record');
const canvas = $('wave');
const pen = canvas.getContext('2d');
const paulGlow = $('paul-glow');
const paulOutline = $('paul-outline');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let glowLevel = 0, lastGlowTime = performance.now();
let playbackAnalyser, playbackLevels;
const micLevels = new Float32Array(2048);
let context, recorder, stream, analyser, mic, original, source;
let workletReady;
let hallEffect, distortionEffect, effectTailTimer;
let recording = false, busy = false, backwards = true;
let pendingPlayback = null;
let startedAt = 0, playbackClock, playbackDuration = 0, limitTimer;
let displayedSamples = null;
const formatTime = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

function status(message) { $('status').textContent = message; }
function syncControls() {
  $('controls').disabled = !original || recording || busy;
  $('reset').disabled = !original || recording || busy;
  recordButton.disabled = busy;
  const recordLabel = recording ? 'Aufnahme beenden' : original ? 'Neu aufnehmen' : 'Aufnahme starten';
  recordButton.setAttribute('aria-label', recordLabel);
  recordButton.title = recordLabel;
  for (const [id, direction] of [['forward', false], ['reverse', true]]) {
    const active = Boolean(source) && backwards === direction;
    $(id).disabled = busy || (!original && !recording);
    const label = recording
      ? `Aufnahme beenden und ${direction ? 'rückwärts' : 'vorwärts'} abspielen`
      : active ? 'Wiedergabe stoppen' : direction ? 'Rückwärts abspielen' : 'Vorwärts abspielen';
    $(id).setAttribute('aria-label', label);
    $(id).title = label;
    $(id).classList.toggle('selected', active);
    $(id).setAttribute('aria-pressed', String(active));
  }
}
async function audioContext() {
  context ??= new AudioContext();
  if (context.state !== 'running') await context.resume();
  return context;
}
function stopPlayback() {
  clearTimeout(effectTailTimer);
  if (source) { source.onended = null; source.stop(); source.disconnect(); source = null; }
  hallEffect?.dispose(); hallEffect = null;
  distortionEffect?.dispose(); distortionEffect = null;
  syncControls();
}
function releaseMic() {
  stream?.getTracks().forEach(track => track.stop());
  mic?.disconnect();
  stream = null; mic = null; analyser = null;
}
function stopRecording() {
  if (!recording) return;
  clearTimeout(limitTimer);
  recording = false; busy = true;
  recorder.port.postMessage({ type: 'stop' });
  document.body.classList.remove('recording');
  status('Deine Aufnahme wird vorbereitet …'); syncControls();
}
recordButton.addEventListener('click', async () => {
  if (recording) { stopRecording(); return; }
  stopPlayback(); busy = true; syncControls();
  try {
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) throw new Error('unsupported');
    await audioContext();
    status('Erlaube das Mikrofon im Browser, damit Paul dich hören kann.');
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Capture PCM directly: no browser-specific compressed format to decode.
    workletReady ??= context.audioWorklet.addModule(new URL('./recorder-worklet.js', import.meta.url)).catch(error => {
      workletReady = null; throw error;
    });
    await workletReady;
    await context.resume();
    recorder = new AudioWorkletNode(context, 'voice-recorder');
    recorder.port.onmessage = ({ data }) => {
      if (data.type !== 'complete') return;
      clearTimeout(limitTimer);
      recording = false;
      releaseMic();
      recorder.disconnect(); recorder.port.close(); recorder = null;
      document.body.classList.remove('recording');
      try {
        if (data.samples.length < context.sampleRate * .15) throw new Error('short');
        const samples = trimSilence(data.samples, context.sampleRate);
        const decoded = context.createBuffer(1, samples.length, context.sampleRate);
        decoded.copyToChannel(samples, 0);
        original = decoded;
        displayedSamples = original.getChannelData(0);
        $('timer').textContent = formatTime(original.duration);
        status('');
      } catch (error) {
        pendingPlayback = null;
        status(error.message === 'short'
          ? 'Noch zu kurz! Sprich bitte mindestens eine Sekunde und stoppe dann die Aufnahme.'
          : 'Die Aufnahme konnte nicht verarbeitet werden. Bitte versuche es erneut.');
        console.error('Aufnahmeverarbeitung:', error);
      } finally { busy = false; syncControls(); }
      if (pendingPlayback !== null) {
        const direction = pendingPlayback;
        pendingPlayback = null;
        void playDirection(direction);
      }
    };
    recorder.onprocessorerror = () => {
      pendingPlayback = null;
      clearTimeout(limitTimer); recording = false; busy = false; releaseMic();
      recorder.disconnect(); recorder.port.close(); recorder = null;
      document.body.classList.remove('recording');
      status('Die Aufnahme wurde unterbrochen. Versuch es noch einmal.'); syncControls();
    };
    analyser = context.createAnalyser(); analyser.fftSize = 2048;
    mic = context.createMediaStreamSource(stream); mic.connect(analyser);
    mic.connect(recorder);
    // The processor outputs silence: connecting it keeps capture active without echo.
    recorder.connect(context.destination);
    recording = true; busy = false; startedAt = performance.now();
    document.body.classList.add('recording');
    status('Aufnahme läuft · maximal 1 Minute');
    limitTimer = setTimeout(stopRecording, 60_000); syncControls();
  } catch (error) {
    releaseMic(); recorder?.disconnect(); recorder?.port.close(); recorder = null; busy = false;
    const messages = {
      NotAllowedError: 'Das Mikrofon ist noch gesperrt. Erlaube es über das Symbol neben der Browser-Adresse und versuche es erneut.',
      NotFoundError: 'Kein Mikrofon gefunden. Schließe eines an und versuche es erneut.',
      NotReadableError: 'Das Mikrofon ist gerade nicht verfügbar. Prüfe, ob eine andere App es verwendet.'
    };
    status(messages[error.name] || (error.message === 'unsupported' ? 'Bitte öffne die App in einem aktuellen Browser über localhost oder HTTPS.' : 'Das Mikrofon konnte nicht gestartet werden. Bitte versuche es erneut.'));
    syncControls();
  }
});

$('forward').addEventListener('click', () => playDirection(false));
$('reverse').addEventListener('click', () => playDirection(true));
function updateEffects() {
  const pitch = Number($('pitch').value);
  const rate = 2 ** (pitch / 12);
  $('pitch-value').textContent = pitch === 0 ? 'Normal' : `${rate.toFixed(2).replace('.', ',')}×`;
  if (source) {
    const now = context.currentTime;
    const currentRate = playbackClock.change(now, rate);
    source.playbackRate.cancelScheduledValues(now);
    source.playbackRate.setValueAtTime(currentRate, now);
    source.playbackRate.linearRampToValueAtTime(rate, now + .03);
  }
}
$('pitch').addEventListener('input', updateEffects);
function updateHall() {
  const amount = Number($('hall-amount').value);
  $('hall-value').textContent = amount === 0 ? 'Aus' : `${amount} %`;
  hallEffect?.setAmount(amount / 100);
}
$('hall-amount').addEventListener('input', updateHall);
function updateDistortion() {
  const amount = Number($('distortion-amount').value);
  $('distortion-value').textContent = amount === 0 ? 'Aus' : `${amount} %`;
  distortionEffect?.setAmount(amount / 100);
}
$('distortion-amount').addEventListener('input', updateDistortion);
$('reset').addEventListener('click', () => {
  $('pitch').value = '0'; $('hall-amount').value = '0'; $('distortion-amount').value = '0';
  updateEffects(); updateHall(); updateDistortion();
});
async function playDirection(direction) {
  if (recording && !busy) {
    pendingPlayback = direction;
    stopRecording();
    return;
  }
  if (!original || recording || busy) return;
  if (source && backwards === direction) { stopPlayback(); return; }
  stopPlayback();
  backwards = direction;
  busy = true; syncControls();
  try {
    await audioContext();
    const channels = [];
    for (let c = 0; c < original.numberOfChannels; c++) {
      const samples = original.getChannelData(c);
      channels.push(backwards ? reverseSamples(samples) : samples);
    }
    const buffer = context.createBuffer(channels.length, channels[0].length, original.sampleRate);
    channels.forEach((data, c) => buffer.copyToChannel(data, c));
    source = context.createBufferSource(); source.buffer = buffer;
    hallEffect = createHallEffect(context, Number($('hall-amount').value) / 100);
    distortionEffect = createDistortionEffect(context, Number($('distortion-amount').value) / 100);
    source.connect(distortionEffect.input);
    distortionEffect.output.connect(hallEffect.input);
    if (!playbackAnalyser) {
      playbackAnalyser = context.createAnalyser();
      playbackAnalyser.fftSize = 2048;
      playbackLevels = new Float32Array(playbackAnalyser.fftSize);
      playbackAnalyser.connect(context.destination);
    }
    hallEffect.output.connect(playbackAnalyser);
    // Native resampling changes pitch and tempo together without granular overlap.
    source.playbackRate.value = 2 ** (Number($('pitch').value) / 12);
    source.onended = () => {
      source?.disconnect(); source = null;
      // Let the short delayed copies finish after the original voice ends.
      effectTailTimer = setTimeout(() => {
        hallEffect?.dispose(); hallEffect = null;
        distortionEffect?.dispose(); distortionEffect = null;
      }, 500);
      syncControls();
    };
    const startTime = context.currentTime;
    playbackClock = new PlaybackClock(startTime, source.playbackRate.value);
    playbackDuration = buffer.duration;
    source.start(startTime);
    status('');
  } catch {
    if (source) { source.onended = null; source.disconnect(); source = null; }
    hallEffect?.dispose(); hallEffect = null;
    distortionEffect?.dispose(); distortionEffect = null;
    status('Die Wiedergabe hat nicht geklappt. Versuche es noch einmal.');
  }
  finally { busy = false; syncControls(); }
}

function updatePaulGlow(samples) {
  let energy = 0;
  if (samples) for (const sample of samples) energy += sample * sample;
  const rms = samples?.length ? Math.sqrt(energy / samples.length) : 0;
  // Quiet phone recordings need a stronger visual response than a linear meter.
  const target = reducedMotion.matches ? 0 : Math.min(1, Math.max(0, (rms - .002) * 28) ** .5);
  const now = performance.now();
  const elapsed = Math.min(.1, Math.max(0, (now - lastGlowTime) / 1000));
  lastGlowTime = now;
  // A quick response and slower release keep the glow lively without flickering.
  const smoothing = 1 - Math.exp(-elapsed / (target > glowLevel ? .04 : .38));
  glowLevel += (target - glowLevel) * smoothing;
  if (glowLevel < .001) glowLevel = 0;
  // Animate explicit SVG attributes, avoiding nested CSS drop-shadow filters.
  paulGlow.setAttribute('opacity', glowLevel.toFixed(3));
  paulOutline.setAttribute('stroke-width', (2.4 + glowLevel * 1.2).toFixed(3));
}

function draw() {
  const width = canvas.clientWidth, height = canvas.clientHeight, ratio = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) { canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); }
  pen.setTransform(ratio, 0, 0, ratio, 0, 0); pen.clearRect(0, 0, width, height);
  let data = displayedSamples;
  let liveSamples = null;
  if (recording && analyser) {
    analyser.getFloatTimeDomainData(micLevels);
    data = micLevels;
    liveSamples = micLevels;
    $('timer').textContent = `${formatTime(Math.min(60, (performance.now() - startedAt) / 1000))} / 1:00`;
  } else if (hallEffect && playbackAnalyser) {
    playbackAnalyser.getFloatTimeDomainData(playbackLevels);
    liveSamples = playbackLevels;
  }
  updatePaulGlow(liveSamples);
  const count = Math.floor(width / 7);
  const progress = source ? Math.min(1, playbackClock.positionAt(context.currentTime) / playbackDuration) : 0;
  for (let i = 0; i < count; i++) {
    let amplitude = 0;
    if (data?.length) {
      const from = Math.floor(i * data.length / count), to = Math.floor((i + 1) * data.length / count);
      for (let j = from; j < to; j += Math.max(1, Math.floor((to - from) / 100))) amplitude = Math.max(amplitude, Math.abs(data[j]));
    } else amplitude = .035 + .10 * Math.abs(Math.sin(i * .7)) * Math.sin(Math.PI * i / count) ** 2;
    const bar = Math.max(4, Math.min(height - 8, amplitude * height * 1.8));
    pen.fillStyle = source && (backwards ? i / count >= 1 - progress : i / count <= progress) ? '#e1ffae' : '#a0ff00';
    pen.beginPath(); pen.roundRect(i * 7, (height - bar) / 2, 3, bar, 2); pen.fill();
  }
  if (source) {
    // Follow the audio clock, including the selected playback speed and direction.
    const position = backwards ? 1 - progress : progress;
    const x = 7 + position * Math.max(0, width - 14);
    pen.save();
    const glow = pen.createLinearGradient(x - 16, 0, x + 16, 0);
    glow.addColorStop(0, 'rgba(255, 0, 40, 0)');
    glow.addColorStop(.35, 'rgba(255, 0, 40, .3)');
    glow.addColorStop(.5, 'rgba(255, 0, 40, .95)');
    glow.addColorStop(.65, 'rgba(255, 0, 40, .3)');
    glow.addColorStop(1, 'rgba(255, 0, 40, 0)');
    pen.fillStyle = glow;
    pen.fillRect(x - 16, 0, 32, height);
    pen.strokeStyle = '#ff8295';
    pen.shadowColor = '#ff0028';
    pen.shadowBlur = 14;
    pen.lineWidth = 1.5;
    pen.beginPath();
    pen.moveTo(x, 0);
    pen.lineTo(x, height);
    pen.stroke();
    pen.restore();
  }
  requestAnimationFrame(draw);
}
window.addEventListener('pagehide', () => { clearTimeout(limitTimer); releaseMic(); recorder?.disconnect(); recorder?.port.close(); stopPlayback(); });
draw();
