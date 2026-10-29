"""Actual Chromium capture, malicious-page/cross-tab probes, mocked providers, local unpack."""
import functools
import http.server
import json
import os
import shutil
import zipfile
from pathlib import Path
import subprocess
import tempfile
import threading
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args): pass

with tempfile.TemporaryDirectory() as temporary:
    base = Path(temporary); fixture = base / 'site'; fixture.mkdir()
    for name in ('index.html', 'next.html', 'other.html'):
        (fixture / name).write_text('<!doctype html><html><head><title>' + name + '</title></head><body><h1 id="title" style="margin:120px;color:rgb(30,50,70)">' + name + '</h1><p>Local synthetic fixture</p></body></html>')
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(fixture)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = 'http://127.0.0.1:' + str(server.server_port)
    environment = os.environ.copy()
    environment.update(XDG_CONFIG_HOME=str(base / 'config'), XDG_STATE_HOME=str(base / 'state'), DEEPGRAM_API_KEY='synthetic-private-deepgram', GROQ_API_KEY='synthetic-private-groq')
    setup = subprocess.run(['python3', str(ROOT / 'tools/disdat.py'), 'setup', '--provider', 'groq'], env=environment, capture_output=True, text=True, check=True)
    configured_runtime = Path(json.loads(setup.stdout)['extension'])
    # Exercise the released ZIP bytes; only the private, mocked-provider configuration differs.
    installer = base / 'extension.zip'
    subprocess.run(['python3', str(ROOT / 'tools/package-extension.py'), '--output', str(installer)],
                   capture_output=True, text=True, check=True)
    with zipfile.ZipFile(installer) as archive:
        archive.extractall(base / 'packaged')
    packaged_runtime = base / 'packaged/disdat-extension'
    shutil.copyfile(configured_runtime / 'local-config.js', packaged_runtime / 'local-config.js')
    runtime = str(packaged_runtime)
    with sync_playwright() as playwright:
        context = playwright.chromium.launch_persistent_context(str(base / 'profile'), channel='chromium', headless=True, accept_downloads=True, args=['--disable-extensions-except=' + runtime, '--load-extension=' + runtime, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'])
        unexpected_network = []
        def route_request(route):
            if route.request.url.startswith((origin, 'chrome-extension://', 'data:')): route.continue_()
            else: unexpected_network.append(route.request.url.split('?')[0]); route.abort()
        context.route('**/*', route_request)
        # Page-world code attempts to read the old Blob-anchor and open-shadow leaks.
        context.add_init_script('''
          window.__blobAttempts = []; window.__readableBriefing = [];
          for (const event of ['copy','selectionchange']) document.addEventListener(event, () => {
            const selected=window.getSelection()?.toString(); if(selected)window.__readableBriefing.push(selected);
          },true);
          new MutationObserver(records => {
            for (const record of records) for (const node of record.addedNodes) {
              if (node.nodeType !== 1) continue;
              if (node.tagName === 'TEXTAREA' && node.value) window.__readableBriefing.push(node.value);
              for (const anchor of [node, ...node.querySelectorAll('a')]) {
                if (anchor.href?.startsWith('blob:')) {
                  window.__blobAttempts.push(anchor.href);
                  fetch(anchor.href).then(r => r.text()).then(text => window.__readableBriefing.push(text)).catch(() => {});
                }
              }
              const text = document.querySelector('[data-disdat-host]')?.shadowRoot?.querySelector('#pout')?.textContent;
              if (text) window.__readableBriefing.push(text);
            }
          }).observe(document, {childList:true,subtree:true});
        ''')
        worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker', timeout=10000)
        worker.evaluate('''() => {
          globalThis.__providerRequests = []; globalThis.__testDownloadId = null;
          globalThis.__testAudioMode='fail';
          const originalHandleMessage=handleMessage;
          handleMessage=(message,sender,send)=>{
            const hold=message?.type==='startSession' && globalThis.__testAudioMode==='fail';
            return originalHandleMessage(message,sender,response=>{
              if(hold)globalThis.__releaseFailureAck=()=>send(response);else send(response);
            });
          };
          const originalStartAudio=startAudio;
          startAudio=async sessionId=>{
            const mode=globalThis.__testAudioMode;
            if(mode==='fail')return {error:'NotFoundError'};
            if(mode==='hold')await new Promise(resolve=>{globalThis.__releaseStart=resolve;});
            return originalStartAudio(sessionId);
          };
          chrome.downloads.onCreated.addListener(item => { if (item.url.startsWith('blob:chrome-extension://')) globalThis.__testDownloadId = item.id; });
          const original = fetch;
          globalThis.fetch = async (url, options) => {
            const address = typeof url === 'string' ? url : url.url;
            globalThis.__providerRequests.push(address.startsWith('data:') ? 'data:local-image' : address);
            if (address.startsWith('https://api.deepgram.com/')) return new Response(JSON.stringify({results:{channels:[{alternatives:[{transcript:'Make this title blue.',words:[{word:'Make',start:0},{word:'this',start:0.2},{word:'title',start:0.4},{word:'blue',start:0.6}]}]}]},metadata:{duration:1}}),{status:200,headers:{'Content-Type':'application/json'}});
            if (address.startsWith('https://api.groq.com/')) return new Response(JSON.stringify({choices:[{message:{content:'Make the captured title blue.'}}],usage:{prompt_tokens:10,completion_tokens:8}}),{status:200,headers:{'Content-Type':'application/json'}});
            if (address.startsWith('http://127.0.0.1:') || address.startsWith('data:')) return original(url,options);
            throw new Error('Unmocked network request blocked');
          };
        }''')
        page = context.new_page(); page.goto(origin + '/index.html'); page.bring_to_front()
        downloads = base / 'downloads'; downloads.mkdir()
        context.new_cdp_session(page).send('Browser.setDownloadBehavior', {'behavior':'allow', 'downloadPath':str(downloads), 'eventsEnabled':True})
        tab_id = worker.evaluate('''async origin => { const tab=(await chrome.tabs.query({})).find(t=>t.url===origin+'/index.html'); await activate(tab); return tab.id; }''', origin)
        def overlay(selector, action='rect'):
            return worker.evaluate('''async ({tabId,selector,action}) => (await chrome.scripting.executeScript({target:{tabId},func:(selector,action)=>{
              const host=document.querySelector('[data-disdat-host]'); const root=host&&chrome.dom.openOrClosedShadowRoot(host); const element=root?.querySelector(selector);
              if(!element)return null;
              if(action==='disabled')return !!element.disabled;
              if(element.disabled)return null;
              if(action==='text'){const r=element.getBoundingClientRect();return r.width&&r.height?element.textContent:null;}
              element.scrollIntoView({block:'center'});
              const rect=element.getBoundingClientRect(); return {x:rect.x+rect.width/2,y:rect.y+rect.height/2,width:rect.width,height:rect.height};
            },args:[selector,action]}))[0]?.result''', {'tabId':tab_id,'selector':selector,'action':action})
        def wait_text(selector, text):
            for _ in range(150):
                if text in (overlay(selector,'text') or ''): return
                page.wait_for_timeout(100)
            raise AssertionError('Extension overlay did not reach expected state: ' + str(overlay(selector,'text')) + '; state=' + str(worker.evaluate('S && {owner:S.ownerTabId,events:S.events.length}')))
        def click_overlay(selector):
            for _ in range(100):
                rect = overlay(selector)
                if rect and rect['width'] and rect['height']:
                    page.mouse.click(rect['x'],rect['y']); return
                page.wait_for_timeout(100)
            raise AssertionError('Extension overlay control unavailable')
        click_overlay('#hstart'); wait_text('#hstartl','Try microphone again')
        assert worker.evaluate('S===null && __testDownloadId===null && __providerRequests.length===0'), 'Failed microphone produced capture/provider work'
        worker.evaluate("__testAudioMode='hold'")
        click_overlay('#hstart'); wait_text('#recl','Starting microphone')
        worker.evaluate('__releaseFailureAck()')
        assert overlay('#rec','disabled') is True
        assert worker.evaluate("S?.audioState==='starting'"), 'Stale failed acknowledgment cancelled the new attempt'
        pending_stop=worker.evaluate('stopSession()')
        assert pending_stop.get('error')=='microphone-starting' and 'session' not in pending_stop
        assert worker.evaluate('__testDownloadId===null && __providerRequests.length===0')
        click_overlay('#esc')
        for _ in range(100):
            if worker.evaluate('S===null'):break
            page.wait_for_timeout(50)
        assert worker.evaluate('S===null')
        worker.evaluate('''async tabId=>{__testAudioMode='real';await activate(await chrome.tabs.get(tabId));}''',tab_id)
        click_overlay('#hstart'); wait_text('#recl','Stop')
        worker.evaluate('__releaseStart()')
        # A privileged CDP session observes the actual offscreen recorder and waits for a real chunk.
        cdp=context.new_cdp_session(page)
        target=next(item for item in cdp.send('Target.getTargets')['targetInfos'] if item['url'].endswith('/offscreen.html'))
        offscreen_session=cdp.send('Target.attachToTarget',{'targetId':target['targetId'],'flatten':False})['sessionId']
        replies={}
        def receive_reply(event):
            message=json.loads(event['message'])
            if 'id' in message:replies[message['id']]=message
        cdp.on('Target.receivedMessageFromTarget',receive_reply)
        expression='''(async()=>{
          if(!rec||rec.state!=='recording')return {error:'recorder-not-ready'};
          const current=rec;
          const bytes=await new Promise((resolve,reject)=>{
            const timer=setTimeout(()=>{current.removeEventListener('dataavailable',onData);reject(new Error('audio-chunk-timeout'));},10000);
            const onData=event=>{if(event.data.size){clearTimeout(timer);current.removeEventListener('dataavailable',onData);resolve(event.data.size);}else current.requestData();};
            current.addEventListener('dataavailable',onData);current.requestData();
          });
          return {state:current.state,chunkBytes:bytes};
        })()'''
        cdp.send('Target.sendMessageToTarget',{'sessionId':offscreen_session,'message':json.dumps({'id':1,'method':'Runtime.evaluate','params':{'expression':expression,'awaitPromise':True,'returnByValue':True}})})
        for _ in range(220):
            if 1 in replies:break
            page.wait_for_timeout(50)
        assert 1 in replies, 'Offscreen audio barrier did not finish'
        audio_barrier=replies[1].get('result',{}).get('result',{}).get('value',{})
        assert audio_barrier.get('state')=='recording' and audio_barrier.get('chunkBytes',0)>0, replies[1]
        cdp.send('Target.detachFromTarget',{'sessionId':offscreen_session})
        page.evaluate("localStorage.setItem('appState', JSON.stringify({theme:'dark',auth:{access_token:'SYNTHETIC NESTED STORAGE SECRET'}}))")
        page.locator('#title').hover(); page.wait_for_timeout(800)
        assert page.evaluate("document.querySelector('[data-disdat-host]').shadowRoot === null")
        foreign = context.new_page(); foreign.goto(origin + '/other.html'); foreign.bring_to_front(); foreign.wait_for_timeout(700)
        assert foreign.locator('[data-disdat-host]').count() == 0, 'Unactivated tab inherited capture UI'
        inactive = worker.evaluate('''async tabId => {const tab=await chrome.tabs.get(tabId); return captureShot({id:chrome.runtime.id,frameId:0,tab});}''', tab_id)
        assert inactive.get('error') == 'capture-tab-inactive' and 'url' not in inactive
        assert page.evaluate('__blobAttempts.length + __readableBriefing.length') == 0
        page.bring_to_front(); page.goto(origin + '/next.html'); wait_text('#recl','Stop')
        page.locator('#title').hover(); page.wait_for_timeout(800)
        click_overlay('#rec')
        record = None
        for _ in range(250):
            record = worker.evaluate('''async () => globalThis.__testDownloadId===null ? null : (await chrome.downloads.search({id:globalThis.__testDownloadId}))[0]''')
            if record and record['state'] == 'complete': break
            page.wait_for_timeout(100)
        assert record and record['state'] == 'complete', 'Extension-owned download did not complete'
        click_overlay('#copy'); page.wait_for_timeout(50)
        selection_leak = page.evaluate('''() => {
          window.find('Make'); const selected=window.getSelection();
          selected.modify('extend','forward','documentboundary');
          const exposed=selected.toString().includes('captured title blue'); selected.removeAllRanges(); return exposed;
        }''')
        assert not selection_leak, 'Page selection APIs exposed the closed-overlay briefing'
        capture_path = Path(record['filename']); assert capture_path.is_relative_to(downloads)
        capture = json.loads(capture_path.read_text()); core = capture['artifacts']['core']
        assert record['url'].startswith('blob:chrome-extension://'), 'Capture Blob must belong to the extension'
        assert capture['format'] == 'disdat.capture/v1' and core['meta']['version'] == '0.30.0'
        assert core['transcript'] == 'Make this title blue.'
        encoded = json.dumps(capture); assert '/other.html' not in encoded
        assert '/index.html' in encoded and '/next.html' in encoded, 'Same-tab navigation context was lost'
        assert 'SYNTHETIC NESTED STORAGE SECRET' not in encoded
        assert json.loads(core['state']['localStorage']['appState'])['theme'] == 'dark'
        assert page.evaluate('__blobAttempts.length + __readableBriefing.length') == 0
        assert page.evaluate("document.querySelector('[data-disdat-host]').shadowRoot === null")
        assert foreign.locator('[data-disdat-host]').count() == 0
        requests = worker.evaluate('__providerRequests')
        assert all(url.startswith(('https://api.deepgram.com/','https://api.groq.com/','http://127.0.0.1:','data:')) for url in requests)
        assert unexpected_network == [], 'Unexpected page network destination'
        unpacked = subprocess.run(['python3',str(ROOT/'tools/disdat.py'),'unpack',str(capture_path)],capture_output=True,text=True)
        assert unpacked.returncode == 0, unpacked.stderr
        print(json.dumps({'actual_extension':'passed','failed_microphone_recovery':'passed','pending_stop_rejected':'passed','pending_cancel_quick_restart':'passed','late_cancelled_start_isolated':'passed','actual_recorder_chunk_barrier':'passed','fake_microphone_capture':'passed','mocked_provider_requests':len([url for url in requests if url.startswith('https:')]),'extension_owned_blob':'passed','closed_overlay':'passed','malicious_page_observer':'passed','foreign_tab_exclusion':'passed','inactive_screenshot_skipped':'passed','same_tab_navigation':'passed','nested_storage_redaction':'passed','local_artifacts':list(capture['artifacts']),'owner_or_upload_requests':0,'agent_unpack':'passed'}))
        context.close()
    server.shutdown()
