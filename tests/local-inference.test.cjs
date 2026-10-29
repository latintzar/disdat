const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function adapter(config = {}, gpu = {}) {
  const calls = [];
  const input = fs.readFileSync(path.join(__dirname, '../extension/local-inference.js'), 'utf8')
    .replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  const env = {backends: {onnx: {wasm: {}}}};
  const webllm = {
    prebuiltAppConfig: {model_list: [{model_id:'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
      model:'https://weights.example', model_lib:'https://upstream.example/version-matched.wasm'}]},
    CreateMLCEngine: async (model, options) => {
      calls.push({kind:'engine', model, options});
      return {chat:{completions:{create:async request => {
        calls.push({kind:'prompt', request}); return {choices:[{message:{content:'synthetic briefing'}}]};
      }}}};
    }
  };
  const pipeline = async (kind, model, options) => {
    calls.push({kind:'asr', task:kind, model, options});
    return async (samples, settings) => {
      calls.push({kind:'transcribe', samples, settings});
      return {text:'synthetic speech', chunks:[{text:'hello', timestamp:[0.5,1]}]};
    };
  };
  class AudioContext {
    async decodeAudioData() { return {sampleRate:16000,duration:1,getChannelData:() => new Float32Array([0,0])}; }
    async close() {}
  }
  const context = vm.createContext({webllm, pipeline, env, chrome:{runtime:{getURL:p=>'chrome-extension://test/'+p}},
    navigator:{gpu}, self:{AudioContext, DISDAT_CONFIG:config}, Float32Array, console});
  vm.runInContext(input, context);
  return {calls, env, run: code => vm.runInContext(code, context)};
}

test('local adapter preserves official upstream model record by default', async () => {
  const a = adapter();
  const ready = await a.run('initialize()');
  assert.equal(ready.ok, true);
  const call = a.calls.find(x => x.kind === 'engine');
  assert.equal(call.model, 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC');
  assert.equal(call.options.appConfig.model_list[0].model_lib, 'https://upstream.example/version-matched.wasm');
  assert.equal(call.options.appConfig.model_list[0].model, 'https://weights.example');
  const result = await a.run("prompt('instructions','synthetic facts',100)");
  assert.equal(result.text, 'synthetic briefing');
  assert.equal(a.env.backends.onnx.wasm.wasmPaths, 'chrome-extension://test/vendor/');
});

test('local adapter keeps original Whisper word timestamps', async () => {
  const a = adapter();
  a.run('globalThis.blob = {arrayBuffer: async () => new ArrayBuffer(0)}');
  const out = await a.run('transcribe(blob)');
  assert.equal(out.transcript, 'synthetic speech');
  assert.equal(out.words[0].t, 0.5);
  assert.equal(a.calls.find(x => x.kind === 'asr').model, 'onnx-community/whisper-base_timestamped');
  assert.equal(a.calls.find(x => x.kind === 'transcribe').settings.return_timestamps, 'word');
});

test('custom library is an explicit extension-origin override', async () => {
  const a = adapter({localModelLibrary:'custom'});
  assert.equal((await a.run('initialize()')).ok, true);
  assert.equal(a.calls.find(x => x.kind === 'engine').options.appConfig.model_list[0].model_lib,
    'chrome-extension://test/vendor/user-model.wasm');
});
test('missing WebGPU fails before model download', async () => {
  const a = adapter({}, undefined);
  // An absent property differs from the default fixture argument.
  a.run('navigator.gpu = undefined');
  assert.equal((await a.run('initialize()')).error, 'WebGPU is unavailable');
  assert.equal(a.calls.length, 0);
});
