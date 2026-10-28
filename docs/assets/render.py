#!/usr/bin/env python3
"""Capture the existing first pointing beat of Dis Dat's authored demo."""
from pathlib import Path
import argparse, datetime, functools, hashlib, http.server, json, struct, threading
from playwright.sync_api import sync_playwright

def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-public',type=Path,required=True)
    args=parser.parse_args()
    source=args.source_public.resolve();base=Path(__file__).resolve().parent
    css=(base/'capture.css').read_text()
    class Handler(http.server.SimpleHTTPRequestHandler):
        def log_message(self,*_args): pass
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(source)))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    origin=f'http://127.0.0.1:{server.server_port}';proof=[]
    try:
        with sync_playwright() as playwright:
            browser=playwright.chromium.launch(headless=True,args=['--disable-dev-shm-usage'])
            for width,height in [(1000,620),(390,242)]:
                context=browser.new_context(viewport={'width':width,'height':height},device_scale_factor=2)
                page=context.new_page();errors=[];blocked=[]
                page.on('pageerror',lambda error:errors.append(str(error)))
                def route(request_route):
                    url=request_route.request.url
                    if url==origin+'/research-vision.html':
                        body=(source/'research-vision.html').read_text().replace('</head>','<style>'+css+'</style></head>',1)
                        request_route.fulfill(status=200,content_type='text/html',body=body)
                    elif url.startswith(origin) or url.startswith('https://fonts.googleapis.com/') or url.startswith('https://fonts.gstatic.com/'):
                        request_route.continue_()
                    else:
                        blocked.append({'url':url,'method':request_route.request.method});request_route.abort()
                context.route('**/*',route)
                # The source already randomizes pointer paths. Seed only that input.
                page.add_init_script('let seed=42;Math.random=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);')
                page.clock.install(time=datetime.datetime(2026,10,28,0,0,0))
                page.clock.pause_at(datetime.datetime(2026,10,28,0,0,1))
                page.goto(origin+'/research-vision.html',wait_until='load')
                page.evaluate('''async () => {
                    await document.fonts.ready;
                    await Promise.all([document.fonts.load('400 15px Inter'),
                        document.fonts.load('900 76px Fraunces'),
                        document.fonts.load('400 11px "JetBrains Mono"')]);
                }''')
                page.clock.run_for(1350)
                page.evaluate('document.getAnimations().forEach(a=>{a.currentTime=1350;a.pause()})')
                measure=page.evaluate('''() => ({title:document.title,
                    phase:document.querySelector('.vhero').dataset.phase,
                    narration:document.querySelector('.vcap-tx').textContent,
                    recordedNoteVisible:document.querySelector('.vnote').classList.contains('show'),
                    scene:document.querySelector('.vhero').getBoundingClientRect().toJSON(),
                    fontCheck:{inter:document.fonts.check('400 15px Inter'),
                        fraunces:document.fonts.check('900 76px Fraunces'),
                        mono:document.fonts.check('400 11px "JetBrains Mono"')},
                    overflow:document.documentElement.scrollWidth>innerWidth})''')
                assert measure['phase']=='poster' and not measure['recordedNoteVisible']
                assert measure['narration']=='this ball looks a bit basic — make it pop.'
                assert not measure['overflow'] and all(measure['fontCheck'].values()), measure
                assert not errors
                image=base/f'point-and-talk-{width}.png';page.screenshot(path=str(image))
                pixel_width,pixel_height=struct.unpack('>II',image.read_bytes()[16:24])
                proof.append({'css_viewport':{'width':width,'height':height},'dpr':2,
                    'pixel_dimensions':{'width':pixel_width,'height':pixel_height},
                    'scene_kind':'Existing authored website demonstration; not live extension capture.',
                    'measure':measure,'errors':errors,'blocked':blocked,
                    'source_sha256':digest(source/'research-vision.html'),
                    'capture_css_sha256':digest(base/'capture.css'),'renderer_sha256':digest(Path(__file__)),
                    'image':str(image),'image_sha256':digest(image)})
                context.close()
            browser.close()
    finally: server.shutdown()
    (base/'proof.json').write_text(json.dumps(proof,indent=2,ensure_ascii=False)+'\n')
    print(json.dumps([{'image':r['image'],'pixel_dimensions':r['pixel_dimensions']} for r in proof],indent=2))

if __name__=='__main__': main()
