import { reverseSamples, transformSamples } from './audio.js';

const $ = (id) => document.getElementById(id);
const recordButton = $('record');
const canvas = $('wave');
const pen = canvas.getContext('2d');
let context, recorder, stream, analyser, mic, original, source;
let workletReady;
let recording = false, busy = false, backwards = true;
let startedAt = 0, playbackStarted = 0, playbackDuration = 0, limitTimer;
let displayedSamples = null;
const formatTime = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

function status(message) { $('status').textContent = message; }
function syncControls() {
  $('controls').disabled = !original || recording || busy;
  $('reset').disabled = !original || recording || busy;
  recordButton.disabled = busy;
  for (const [id, direction] of [['forward', false], ['reverse', true]]) {
    const active = Boolean(source) && backwards === direction;
    $(id).classList.toggle('selected', active);
    $(id).setAttribute('aria-pressed', String(active));
    $(id).querySelector('small').textContent = active ? '■ Stoppen' : 'Jetzt abspielen';
  }
}
async function audioContext() {
  context ??= new AudioContext();
  if (context.state !== 'running') await context.resume();
  return context;
}
function stopPlayback() {
  if (source) { source.onended = null; source.stop(); source.disconnect(); source = null; }
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
  recordButton.innerHTML = '<span aria-hidden="true">●</span> Neu aufnehmen';
  $('record-badge').textContent = 'EINEN MOMENT …';
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
      recordButton.innerHTML = '<span aria-hidden="true">●</span> Neu aufnehmen';
      try {
        if (data.samples.length < context.sampleRate * .15) throw new Error('short');
        const decoded = context.createBuffer(1, data.samples.length, context.sampleRate);
        decoded.copyToChannel(data.samples, 0);
        original = decoded;
        displayedSamples = original.getChannelData(0);
        $('record-badge').textContent = 'IM KASTEN!';
        $('wave-label').textContent = 'Deine Stimme ist bereit';
        $('timer').textContent = formatTime(original.duration);
        $('record-hint').textContent = 'Noch eine Idee? Nimm einfach etwas Neues auf.';
        status('Super! Hör dir deine Stimme an – vorwärts oder rückwärts.');
      } catch (error) {
        $('record-badge').textContent = 'NOCH EIN VERSUCH?';
        status(error.message === 'short'
          ? 'Noch zu kurz! Sprich bitte mindestens eine Sekunde und stoppe dann die Aufnahme.'
          : 'Die Aufnahme konnte nicht verarbeitet werden. Bitte versuche es erneut.');
        console.error('Aufnahmeverarbeitung:', error);
      } finally { busy = false; syncControls(); }
    };
    recorder.onprocessorerror = () => {
      clearTimeout(limitTimer); recording = false; busy = false; releaseMic();
      recorder.disconnect(); recorder.port.close(); recorder = null;
      document.body.classList.remove('recording');
      recordButton.innerHTML = '<span aria-hidden="true">●</span> Aufnahme starten';
      $('record-badge').textContent = 'NOCH EIN VERSUCH?';
      status('Die Aufnahme wurde unterbrochen. Versuch es noch einmal.'); syncControls();
    };
    analyser = context.createAnalyser(); analyser.fftSize = 2048;
    mic = context.createMediaStreamSource(stream); mic.connect(analyser);
    mic.connect(recorder);
    // The processor outputs silence: connecting it keeps capture active without echo.
    recorder.connect(context.destination);
    recording = true; busy = false; startedAt = performance.now();
    document.body.classList.add('recording');
    recordButton.innerHTML = '<span aria-hidden="true">■</span> Aufnahme beenden';
    $('record-badge').textContent = 'PAUL HÖRT ZU';
    $('wave-label').textContent = 'Sprich, sing oder mach Quatsch!';
    status('Aufnahme läuft. Nach einer Minute stoppt sie automatisch.');
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
  stopPlayback();
  $('speed-value').textContent = `${Number($('speed').value).toFixed(1).replace('.', ',')}×`;
  const pitch = Number($('pitch').value);
  $('pitch-value').textContent = pitch === 0 ? 'Normal' : `${pitch > 0 ? '+' : '−'}${Math.abs(pitch)} Halbtöne`;
}
$('speed').addEventListener('input', updateEffects);
$('pitch').addEventListener('input', updateEffects);
$('reset').addEventListener('click', () => { $('speed').value = '1'; $('pitch').value = '0'; updateEffects(); });
async function playDirection(direction) {
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
      channels.push(transformSamples(backwards ? reverseSamples(samples) : samples, original.sampleRate, Number($('speed').value), Number($('pitch').value)));
    }
    const buffer = context.createBuffer(channels.length, channels[0].length, original.sampleRate);
    channels.forEach((data, c) => buffer.copyToChannel(data, c));
    source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination);
    source.onended = () => { source?.disconnect(); source = null; syncControls(); };
    playbackStarted = context.currentTime; playbackDuration = buffer.duration;
    source.start();
    status(backwards ? 'Ohren auf: So klingst du rückwärts!' : 'Ohren auf: So klingst du vorwärts!');
  } catch { status('Die Wiedergabe hat nicht geklappt. Versuche es noch einmal.'); }
  finally { busy = false; syncControls(); }
}

function draw() {
  const width = canvas.clientWidth, height = canvas.clientHeight, ratio = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) { canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); }
  pen.setTransform(ratio, 0, 0, ratio, 0, 0); pen.clearRect(0, 0, width, height);
  let data = displayedSamples;
  if (recording && analyser) {
    data = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(data);
    $('timer').textContent = `${formatTime(Math.min(60, (performance.now() - startedAt) / 1000))} / 1:00`;
  }
  const count = Math.floor(width / 7);
  const progress = source ? Math.min(1, (context.currentTime - playbackStarted) / playbackDuration) : 0;
  for (let i = 0; i < count; i++) {
    let amplitude = 0;
    if (data?.length) {
      const from = Math.floor(i * data.length / count), to = Math.floor((i + 1) * data.length / count);
      for (let j = from; j < to; j += Math.max(1, Math.floor((to - from) / 100))) amplitude = Math.max(amplitude, Math.abs(data[j]));
    } else amplitude = .035 + .10 * Math.abs(Math.sin(i * .7)) * Math.sin(Math.PI * i / count) ** 2;
    const bar = Math.max(4, Math.min(height - 8, amplitude * height * 1.8));
    pen.fillStyle = recording ? '#ed8a76' : source && (backwards ? i / count >= 1 - progress : i / count <= progress) ? '#7961cf' : '#c6b9ed';
    pen.beginPath(); pen.roundRect(i * 7, (height - bar) / 2, 3, bar, 2); pen.fill();
  }
  requestAnimationFrame(draw);
}
window.addEventListener('pagehide', () => { clearTimeout(limitTimer); releaseMic(); recorder?.disconnect(); recorder?.port.close(); source?.stop(); });
draw();
