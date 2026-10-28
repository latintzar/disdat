const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const EXTENSION = path.join(__dirname, '..', 'extension');

function background(config, response) {
  const requests = [], listeners = [];
  const local = { dd_auth: { access_token: 'existing-hosted-test-session', expires_at: Date.now() + 3600000 } };
  const store = values => ({
    get: (keys, callback) => { const result = Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(k => k in values).map(k => [k, values[k]])); if (callback) callback(result); else return Promise.resolve(result); },
    set: (next, callback) => { Object.assign(values, next); if (callback) callback(); return Promise.resolve(); },
    remove: keys => { for (const key of Array.isArray(keys)?keys:[keys]) delete values[key]; return Promise.resolve(); },
  });
  const event = { addListener() {} }, events = {};
  const tabEvent = name => ({addListener(fn) {events[name] = fn;}});
  const context = vm.createContext({
    DISDAT_CONFIG: config, Date, URL, URLSearchParams, Blob, Response, FormData, AbortSignal, crypto: require('node:crypto').webcrypto,
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    console: { log() {}, warn() {}, error() {}, info() {} }, addEventListener() {},
    chrome: { storage: { local: store(local), session: store({}) }, action: { onClicked: event },
      commands: { onCommand: event }, tabs: { sendMessage: async () => ({}), onUpdated: event, onActivated: tabEvent('activated'), onRemoved: tabEvent('removed'), onDetached: tabEvent('detached') }, webNavigation: { onCommitted: event },
      identity: { getRedirectURL: () => 'https://test.chromiumapp.org/' },
      runtime: { id: 'test-extension', getURL: path => 'chrome-extension://test-extension/'+path, getManifest: () => ({ version: '0.30.0' }), onInstalled: event, onConnect: event,
        onMessage: { addListener(fn) { listeners.push(fn); } } } },
    fetch: async (url, options) => { requests.push({ url, options }); return response(url, options); },
  });
  context.self = context;
  context.importScripts = file => { if (file !== 'local-config.js') vm.runInContext(fs.readFileSync(path.join(EXTENSION, file), 'utf8'), context); };
  vm.runInContext(fs.readFileSync(path.join(EXTENSION, 'background.js'), 'utf8'), context);
  return { context, requests, listeners, events, run: code => vm.runInContext(code, context) };
}

function ok(data, status = 200) { return { ok: status >= 200 && status < 300, status, json: async () => data, text: async () => JSON.stringify(data) }; }
function own(provider) { return { mode: 'byok', llmProvider: provider, llmModel: 'selected-model', deepgramKey: 'private-deepgram-test-value', llmKey: 'private-briefing-test-value' }; }

for (const provider of ['groq', 'anthropic']) {
  test(`own-key ${provider} bypasses saved hosted identity and owner services`, async () => {
    const state = background(own(provider), url => url.includes('deepgram')
      ? ok({ results: { channels: [{ alternatives: [{ transcript: 'recorded words', words: [] }] }] } })
      : provider === 'groq' ? ok({ choices: [{ message: { content: 'briefing' } }] }) : ok({ content: [{ text: 'briefing' }] }));
    assert.equal(await state.run('getToken()'), null);
    const identity = await state.run('me()');
    assert.equal(identity.ready, true); assert.equal(identity.mode, 'byok'); assert.equal(identity.version, '0.30.0');
    assert.doesNotMatch(JSON.stringify(identity), /private-|existing-hosted/);
    assert.equal((await state.run("deepgramBytes(new Uint8Array([1]), 'audio/webm')")).transcript, 'recorded words');
    assert.equal((await state.run("llm('system', 'captured facts', 100)")).text, 'briefing');
    await state.run("logDebug({ private: 'capture' })");
    state.run("rlog('content', 'error', 'test', { private: 'capture' }); flushRlog()");
    assert.equal((await state.run("uploadBundle('{}', 'capture')")).error, 'hosted-mode-required');
    assert.equal(state.requests.length, 2);
    assert.match(state.requests[0].url, /^https:\/\/api\.deepgram\.com\//);
    assert.match(state.requests[1].url, provider === 'groq' ? /^https:\/\/api\.groq\.com\// : /^https:\/\/api\.anthropic\.com\//);
    assert.equal(JSON.parse(state.requests[1].options.body).model, 'selected-model');
    assert.ok(state.requests.every(r => !/disdat\.dev|supabase|litterbox|tmpfiles/.test(r.url)));
    let disclosed = false;
    state.listeners[0]({ type: 'getkeys' }, {}, () => { disclosed = true; });
    assert.equal(disclosed, false);
  });
}

test('provider rejection stays with the selected provider', async () => {
  const state = background(own('groq'), () => ok({ error: 'rejected' }, 401));
  assert.equal((await state.run("llm('system', 'facts', 100)")).error, 'groq 401');
  assert.equal(state.requests.length, 1);
});

test('default Groq model uses its documented completion and reasoning fields', async () => {
  const config = own('groq'); delete config.llmModel;
  const state = background(config, () => ok({ choices: [{ message: { content: 'final briefing', reasoning: 'separate reasoning' } }] }));
  assert.equal((await state.run("llm('system', 'facts', 100)")).text, 'final briefing');
  const request = JSON.parse(state.requests[0].options.body);
  assert.equal(request.model, 'openai/gpt-oss-20b');
  assert.equal(request.include_reasoning, false);
  assert.equal(request.reasoning_effort, 'low');
  assert.ok(request.max_completion_tokens >= 2048);
  assert.equal(request.reasoning_format, undefined);
});

test('Anthropic text extraction handles non-text blocks before the final answer', async () => {
  const state = background(own('anthropic'), () => ok({ content: [{ type: 'thinking', thinking: 'separate reasoning' },
    { type: 'text', text: 'first paragraph' }, { type: 'text', text: 'second paragraph' }] }));
  assert.equal((await state.run("llm('system', 'facts')")).text, 'first paragraph\nsecond paragraph');
});

test('unconfigured source requests setup and performs zero network calls', async () => {
  const state = background({}, () => { throw new Error('unexpected network'); });
  assert.equal((await state.run('me()')).ready, false);
  assert.equal((await state.run("llm('system', 'facts')")).error, 'setup-required');
  assert.equal((await state.run("deepgramBytes(new Uint8Array([1]), 'audio/webm')")).error, 'setup-required');
  assert.equal(state.requests.length, 0);
});

test('hosted mode retains its existing account and proxy provider route', async () => {
  const state = background({ mode: 'hosted' }, url => url.endsWith('/x/me')
    ? ok({ plan: 'pro', entitled: true }) : url.endsWith('/x/transcribe')
      ? ok({ results: { channels: [{ alternatives: [{ transcript: 'hosted words' }] }] } })
      : ok({ choices: [{ message: { content: 'hosted briefing' } }] }));
  assert.equal((await state.run('me()')).signedIn, true);
  assert.equal((await state.run("deepgramBytes(new Uint8Array([1]), 'audio/webm')")).transcript, 'hosted words');
  assert.equal((await state.run("llm('system', 'facts')")).text, 'hosted briefing');
  assert.deepEqual(state.requests.map(r => r.url), ['https://api.disdat.dev/x/me', 'https://api.disdat.dev/x/transcribe', 'https://api.disdat.dev/x/crunch']);
});

test('local delivery keeps the captured artifact content and creates an agent handoff', () => {
  const local = require('../extension/local-delivery.js');
  const capture = local.bundle([{ key: 'core', json: JSON.stringify({ transcript: 'exact words' }) },
    { key: 'dom', json: JSON.stringify({ html: '<main>actual DOM</main>' }) }], { version: '0.30.0' });
  assert.equal(capture.format, 'disdat.capture/v1');
  assert.equal(capture.artifacts.core.transcript, 'exact words');
  assert.equal(capture.artifacts.dom.html, '<main>actual DOM</main>');
  assert.match(local.handoff('capture.json', 'briefing'), /tools\/disdat\.py unpack/);
  assert.throws(() => local.bundle([{ key: '../escape', json: '{}' }], {}));
});

function bindSession(state) {
  state.run(`S = {ownerTabId: 10, ownerWindowId: 3, startT: 1, audioSessionId: 'test-audio-session', audioState: 'recording', timeline: [], events: [], net: [], mut: [], console: [], render: [], notes: []}; lastCaptureOwner = {tabId:10,windowId:3}`);
  return { id: 'test-extension', frameId: 0, tab: { id: 10, windowId: 3 } };
}
function dispatch(state, message, sender) {
  return new Promise(resolve => state.listeners[0](message, sender, resolve));
}
test('session status, mutations, stop, and capture requests stay with the initiating tab and window', async () => {
  const state = background(own('groq'), () => { throw new Error('unexpected network'); });
  const owner = bindSession(state);
  for (const foreign of [{ ...owner, tab: { id: 11, windowId: 3 } }, { ...owner, tab: { id: 10, windowId: 4 } }, { ...owner, frameId: 1 }]) {
    assert.equal((await dispatch(state, {type:'sessionState'}, foreign)).recording, false);
    for (const type of ['engage','event','net','mut','console','render','note','stopSession','abortSession','shot','llm','fetchassets','local-capture']) {
      assert.equal((await dispatch(state, {type, ev:{url:'foreign'},page:'foreign'}, foreign)).error, 'capture-tab-mismatch', type);
    }
  }
  assert.equal((await dispatch(state, {type:'sessionState'}, owner)).recording, true);
  await dispatch(state, {type:'event',ev:{url:'owner'}}, owner);
  assert.equal(state.run('S.events.length'), 1);
  assert.equal(state.run('S.events[0].url'), 'owner');
  state.context.chrome.scripting = {executeScript: async () => { throw new Error('foreign tab injected'); }};
  await state.run("reinjectIfGone(11,'https://foreign.example/')");
  assert.equal(state.requests.length,0);
});
test('screenshots skip an inactive owner and discard changed, moved, or closed tabs', async () => {
  for (const change of ['inactive','switched','moved','closed','epoch']) {
    const state = background(own('groq'), () => { throw new Error('unexpected network'); });
    const owner = bindSession(state); state.context.sender = owner;
    let reads=0,captures=0;
    state.context.chrome.tabs.get=async () => {
      reads++;
      if(change==='closed' && reads===2) throw new Error('closed');
      return {id:10,windowId:change==='moved'&&reads===2?4:3,active:!(change==='inactive'||change==='switched'&&reads===2)};
    };
    state.context.chrome.tabs.captureVisibleTab=async windowId => {
      captures++;assert.equal(windowId,3);
      if(change==='epoch') state.run('activeTabEpoch++');
      return 'data:image/jpeg;base64,c2FmZQ==';
    };
    const response=await state.run('captureShot(sender)');
    assert.ok(response.error,change);assert.equal(response.url,undefined,change);
    assert.equal(captures,change==='inactive'?0:1);
  }
  const state=background(own('groq'),()=>{});state.context.sender=bindSession(state);
  state.context.chrome.tabs.get=async()=>({id:10,windowId:3,active:true});
  state.context.chrome.tabs.captureVisibleTab=async windowId=>{assert.equal(windowId,3);return 'data:image/jpeg;base64,c2FmZQ==';};
  assert.match((await state.run('captureShot(sender)')).url,/^data:image\/jpeg/);
});
test('closing or moving the initiating tab ends its recording and capture ownership', async () => {
  for (const event of ['removed','detached']) {
    const state=background(own('groq'),()=>{});bindSession(state);
    state.run('stopAudio = async () => ({}); hasOffscreen = async () => false');
    state.events[event](10);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(state.run('S'),null,event);
    assert.equal(state.run('lastCaptureOwner'),null,event);
  }
});
test('local downloads keep Blob URLs inside extension contexts and expose only an opaque receipt', async () => {
  const state=background(own('groq'),()=>{}),owner=bindSession(state);
  state.run('ensureOffscreen = async () => true');
  state.context.chrome.runtime.sendMessage=async request=>{
    assert.equal(request.target,'offscreen');assert.equal(request.owner.tabId,10);
    return {url:'blob:chrome-extension://test-extension/private',receipt:'opaque-receipt',filename:'disdat-capture-proof.json'};
  };
  const downloads=[];state.context.chrome.downloads={download:async request=>{downloads.push(request);return 1;}};
  const result=await dispatch(state,{type:'local-capture',capture:{},filename:'disdat-capture-proof.json'},owner);
  assert.equal(result.ok,true);assert.equal(result.receipt,'opaque-receipt');assert.equal(result.url,undefined);
  assert.equal(downloads[0].url,'blob:chrome-extension://test-extension/private');
  state.context.chrome.downloads.download=async()=>{throw new Error('disabled');};
  const retry=await dispatch(state,{type:'local-capture-retry',receipt:result.receipt},owner);
  assert.equal(retry.error,'capture-download-retry');assert.equal(retry.url,undefined);
  assert.equal(require('../extension/local-delivery.js').download,undefined);
});
test('storage and network bodies recursively redact full sensitive values before truncation', async () => {
  const privacy=require('../extension/privacy.js');
  const sensitive='SYNTHETIC FIRST SECOND "quoted" tail';
  const body=JSON.stringify({theme:'dark',auth:{access_token:sensitive},nested:[{password:sensitive}],layout:{width:80}});
  const sanitized=privacy.clean(body);assert.doesNotMatch(sanitized,/SYNTHETIC|FIRST|SECOND|quoted|tail/);
  const parsed=JSON.parse(sanitized);assert.equal(parsed.theme,'dark');assert.equal(parsed.layout.width,80);
  const storage=privacy.storage({length:1,key:()=> 'appState',getItem:()=>body});
  assert.equal(JSON.parse(storage.appState).layout.width,80);assert.doesNotMatch(storage.appState,/SYNTHETIC/);
  assert.doesNotMatch(privacy.clean('password=SYNTHETIC FIRST SECOND&theme=dark'),/SYNTHETIC|FIRST|SECOND/);
  assert.match(privacy.clean('password=SYNTHETIC FIRST SECOND&theme=dark'),/theme=dark/);
  assert.doesNotMatch(privacy.clean('data: '+JSON.stringify({theme:'dark',password:sensitive})),/SYNTHETIC|FIRST|SECOND|quoted|tail/);
  const messages=[],handlers={},context=vm.createContext({console:{warn(){},error(){}},TextDecoder,URLSearchParams,Headers,FormData,performance:{now:()=>0},setTimeout,clearTimeout,
    EventTarget:class {addEventListener(){}},document:{querySelectorAll:()=>[]},addEventListener:(name,fn)=>{handlers[name]=fn;},postMessage:msg=>messages.push(msg)});
  context.window=context;vm.runInContext(fs.readFileSync(path.join(EXTENSION,'privacy.js'),'utf8'),context);
  context.fetch=async()=>new Response('{}',{headers:{'content-type':'application/json'}});
  context.__messages=messages;
  vm.runInContext(fs.readFileSync(path.join(EXTENSION,'inject-main.js'),'utf8'),context);
  context.messageHandler=handlers.message;
  vm.runInContext('messageHandler({source:window,data:{__disdat_rec:true}})',context);
  context.requestBody=body;
  await vm.runInContext("fetch('https://local.test/request',{method:'POST',body:requestBody})",context);
  await new Promise(resolve=>setImmediate(resolve));
  const request=messages.find(message=>message.__disdat_net)?.__disdat_net;
  assert.ok(request,'actual main-world fetch shim produced an event');
  assert.doesNotMatch(request.reqBody,/SYNTHETIC|FIRST|SECOND|quoted|tail/);
  assert.equal(JSON.parse(request.reqBody).theme,'dark');
});

test('pending microphone rejects Stop; cancel/restart and late readiness stay with their session', async () => {
  const state=background(own('groq'),()=>{throw new Error('unexpected provider request');});
  const owner={id:'test-extension',frameId:0,tab:{id:10,windowId:3}}, starts=[],stops=[];
  state.context.chrome.tabs.sendMessage=async()=>({});
  state.context.startAudio=id=>new Promise(resolve=>starts.push({id,resolve}));
  state.context.stopAudio=async id=>{stops.push(id);return {error:'audio-start-cancelled'};};
  const first=dispatch(state,{type:'startSession',startT:10},owner);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(state.run('S.audioState'),'starting');
  assert.equal((await dispatch(state,{type:'stopSession',startT:10},owner)).error,'microphone-starting');
  assert.equal(stops.length,0);assert.equal(state.requests.length,0);
  await dispatch(state,{type:'abortSession',startT:10},owner);
  const second=dispatch(state,{type:'startSession',startT:20},owner);
  await new Promise(resolve=>setImmediate(resolve));
  assert.notEqual(starts[0].id,starts[1].id);
  starts[0].resolve({ok:true});assert.equal((await first).error,'capture-tab-unavailable');
  assert.equal(state.run('S.startT'),20);assert.equal(state.run('S.audioState'),'starting');
  starts[1].resolve({ok:true});assert.equal((await second).audioState,'recording');
  assert.equal((await dispatch(state,{type:'sessionState'},owner)).audioState,'recording');
  assert.equal((await dispatch(state,{type:'abortSession',startT:10},owner)).error,'capture-session-mismatch');
  assert.equal(state.run('S.startT'),20);assert.ok(stops.every(id=>id===starts[0].id));
});

test('microphone failure remains a failed session and never assembles an empty successful capture', async () => {
  const state=background(own('groq'),()=>{throw new Error('unexpected provider request');});
  const owner={id:'test-extension',frameId:0,tab:{id:10,windowId:3}};
  state.context.startAudio=async()=>({error:'NotAllowedError'});state.context.stopAudio=async()=>({});
  state.context.chrome.tabs.create=()=>{};
  const result=await dispatch(state,{type:'startSession',startT:30},owner);
  assert.equal(result.audioState,'failed');
  const stopped=await dispatch(state,{type:'stopSession',startT:30},owner);
  assert.equal(stopped.error,'microphone-unavailable');assert.equal(stopped.session,undefined);
  await dispatch(state,{type:'abortSession',startT:30},owner);assert.equal(state.run('S'),null);
  assert.equal(state.requests.length,0);
});

test('offscreen cancellation retires a delayed stream without overwriting or stopping a restarted recorder', async () => {
  const requests=[],listeners=[];
  class Recorder {
    static isTypeSupported(){return true;}
    constructor(stream){this.stream=stream;this.state='inactive';}
    start(){this.state='recording';}
    requestData(){this.ondataavailable?.({data:new Blob(['synthetic audio'])});}
    stop(){this.state='inactive';this.onstop?.();}
  }
  const context=vm.createContext({Blob,Uint8Array,btoa,console,MediaRecorder:Recorder,
    navigator:{mediaDevices:{getUserMedia:()=>new Promise(resolve=>requests.push(resolve))}},
    chrome:{runtime:{id:'test-extension',sendMessage:async()=>({}),onMessage:{addListener(fn){listeners.push(fn);}}},
      storage:{local:{get:(_key,reply)=>reply({})}}}});
  context.window=context;vm.runInContext(fs.readFileSync(path.join(EXTENSION,'offscreen.js'),'utf8'),context);
  const run=code=>vm.runInContext(code,context);
  const oldStream={name:'old',stopped:0,getTracks(){return[{stop:()=>this.stopped++}];}};
  const newStream={name:'new',stopped:0,getTracks(){return[{stop:()=>this.stopped++}];}};
  const first=run("start('first')");await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await run("stop('first')")).error,'audio-start-cancelled');
  const second=run("start('second')");await new Promise(resolve=>setImmediate(resolve));
  requests[1](newStream);assert.equal((await second).ok,true);
  requests[0](oldStream);assert.equal((await first).error,'audio-start-cancelled');
  assert.equal(oldStream.stopped,1);assert.equal(newStream.stopped,0);assert.equal(run('rec.stream.name'),'new');
  assert.equal((await run("stop('first')")).error,'audio-session-mismatch');assert.equal(newStream.stopped,0);
  let denied;listeners[0]({target:'offscreen',cmd:'stop',sessionId:'second'},{id:'test-extension',tab:{id:99}},reply=>{denied=reply;});
  assert.equal(denied.error,'offscreen-sender');assert.equal(run('rec.state'),'recording');
  const stopped=await run("stop('second')");assert.ok(stopped.audioB64.length>0);assert.equal(newStream.stopped,1);
});
