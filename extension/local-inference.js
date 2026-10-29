// Derived from Dis Dat v0.6.1's offscreen WebLLM / Whisper implementation.
import * as webllm from './vendor/web-llm.js';
import { pipeline, env } from './vendor/transformers.js';

env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = true;
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('vendor/');
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;

const MODEL = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC';
const ASR_MODEL = 'onnx-community/whisper-base_timestamped';
let engine = null, enginePromise = null, asrPromise = null, progress = null;

export async function initialize() {
  if (engine) return {ok: true, model: MODEL};
  if (!navigator.gpu) return {error: 'WebGPU is unavailable'};
  if (!enginePromise) enginePromise = (async () => {
    const model = webllm.prebuiltAppConfig.model_list.find(item => item.model_id === MODEL);
    if (!model) throw new Error('Bundled WebLLM model configuration is missing');
    // Keep the version-matched upstream record. An explicit private setup can override its library.
    const selected = self.DISDAT_CONFIG?.localModelLibrary === 'custom'
      ? {...model, model_lib: chrome.runtime.getURL('vendor/user-model.wasm')} : model;
    const appConfig = {...webllm.prebuiltAppConfig, model_list: [selected]};
    engine = await webllm.CreateMLCEngine(MODEL, {appConfig,
      initProgressCallback: p => { progress = {text: p.text, progress: p.progress}; }});
    progress = null;
    return {ok: true, model: MODEL};
  })().catch(e => { enginePromise = null; throw e; });
  try { return await enginePromise; } catch (e) { return {error: String(e.message || e)}; }
}

function getASR() {
  if (!asrPromise) asrPromise = pipeline('automatic-speech-recognition', ASR_MODEL, {
    // The pinned ORT q8 graph optimizer rejects Whisper's merged embedding scale.
    device: 'wasm', dtype: 'q8', session_options: {graphOptimizationLevel: 'disabled'},
    progress_callback: p => { if (!engine && p.status === 'progress') progress = {text: 'Voice model: ' + p.status, progress: (p.progress || 0) / 100}; }
  }).catch(e => { asrPromise = null; throw e; });
  return asrPromise;
}

export function warm() { initialize().catch(() => {}); getASR().catch(() => {}); }
export function status() { return {ready: !!engine, model: MODEL, progress}; }

function resample16k(data, rate) {
  if (rate === 16000) return data;
  const ratio = 16000 / rate, n = Math.round(data.length * ratio), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i / ratio, a = Math.floor(x), b = Math.min(a + 1, data.length - 1);
    out[i] = data[a] * (1 - (x - a)) + data[b] * (x - a);
  }
  return out;
}

export async function transcribe(blob) {
  const AC = self.AudioContext || self.webkitAudioContext;
  const ac = new AC();
  try {
    const audio = await ac.decodeAudioData(await blob.arrayBuffer());
    const model = await getASR();
    const out = await model(resample16k(audio.getChannelData(0), audio.sampleRate),
      {language: 'en', return_timestamps: 'word', chunk_length_s: 30});
    const words = (out.chunks || []).map(c => ({t: +(((c.timestamp && c.timestamp[0]) || 0)).toFixed(2),
      w: (c.text || '').trim()})).filter(w => w.w);
    return {transcript: (out.text || '').trim(), words, dur: audio.duration};
  } finally { await ac.close(); }
}

export async function prompt(sys, input, maxTokens) {
  const ready = await initialize();
  if (ready.error) return ready;
  if (input && input.length > 6000) input = input.slice(0, 6000) + '\n…(truncated for the on-device context window)';
  try {
    const out = await engine.chat.completions.create({
      messages: [{role: 'system', content: sys}, {role: 'user', content: input}],
      temperature: 0.3, max_tokens: maxTokens || 800
    });
    return {text: (out.choices?.[0]?.message?.content || '').trim(), via: 'on-device · ' + MODEL};
  } catch (e) { return {error: String(e.message || e)}; }
}
