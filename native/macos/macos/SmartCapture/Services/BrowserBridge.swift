import Foundation
import AppKit

/// Phase 2: Extracts DOM/HTML from browsers when the captured window belongs to one.
/// - Safari: AppleScript JS injection (requires Automation permission)
/// - Chrome/Chromium: Chrome DevTools Protocol via remote debugging port
class BrowserBridge {

    enum BrowserKind: String {
        case safari = "Safari"
        case chrome = "Google Chrome"
        case chromium = "Chromium"
        case edge = "Microsoft Edge"
        case arc = "Arc"
        case brave = "Brave Browser"
        case firefox = "Firefox"       // no CDP/AS support — AX only
        case unknown
    }

    // MARK: - Public API

    /// Detect which browser owns the window at the given point and extract DOM if possible.
    /// Returns simplified HTML string or nil if unavailable.
    static func extractDOM(at point: CGPoint, windowPID: pid_t) async -> String? {
        guard let app = NSRunningApplication(processIdentifier: windowPID) else { return nil }
        let appName = app.localizedName ?? ""
        let kind = detectBrowser(appName: appName)

        print("[BrowserBridge] detected browser: \(kind.rawValue) for pid=\(windowPID)")

        switch kind {
        case .safari:
            return await safariDOM()
        case .chrome, .chromium, .edge, .arc, .brave:
            return await chromeDOM(processName: app.bundleIdentifier ?? "")
        case .firefox, .unknown:
            return nil  // AX tree is the best we can do for these
        }
    }

    /// Check if the app at a point is a known browser.
    static func isBrowser(pid: pid_t) -> Bool {
        guard let app = NSRunningApplication(processIdentifier: pid) else { return false }
        return detectBrowser(appName: app.localizedName ?? "") != .unknown
    }

    // MARK: - Browser detection

    private static func detectBrowser(appName: String) -> BrowserKind {
        let name = appName.lowercased()
        if name.contains("safari") { return .safari }
        if name.contains("chrome") { return .chrome }
        if name.contains("chromium") { return .chromium }
        if name.contains("edge") { return .edge }
        if name.contains("arc") { return .arc }
        if name.contains("brave") { return .brave }
        if name.contains("firefox") { return .firefox }
        return .unknown
    }

    // MARK: - Safari (AppleScript)

    private static func safariDOM() async -> String? {
        let js = domExtractionJS()
        let script = """
        tell application "Safari"
            try
                set theResult to do JavaScript "\(js)" in current tab of front window
                return theResult
            on error errMsg
                return "error:" & errMsg
            end try
        end tell
        """
        let result = await runAppleScript(script)
        if result == nil || result?.hasPrefix("error:") == true {
            print("[BrowserBridge] Safari Automation not granted — \(result ?? "nil")")
            return automationNotGrantedSentinel
        }
        return result
    }

    // MARK: - Chrome / Chromium via AppleScript (no debug port needed)

    /// Sentinel returned when Automation permission is not granted for the browser.
    /// CapturePackager checks for this and renders a helpful warning in context.md.
    static let automationNotGrantedSentinel = "__AUTOMATION_NOT_GRANTED__"

    private static func chromeDOM(processName: String) async -> String? {
        let appName = chromeBundleToAppName(processName)

        // Run a minimal probe first to force macOS to show the Automation permission
        // dialog if it hasn't been shown yet, and to detect if it was denied.
        let probeScript = """
        tell application "\(appName)"
            try
                set u to URL of active tab of front window
                return "ok"
            on error errMsg
                return "error:" & errMsg
            end try
        end tell
        """
        let probe = await runAppleScript(probeScript)

        // If the probe failed (nil = permission denied / app scripting blocked)
        if probe == nil || probe?.hasPrefix("error:") == true {
            print("[BrowserBridge] Chrome Automation not granted for \(appName) — probe failed: \(probe ?? "nil")")
            return automationNotGrantedSentinel
        }

        let jsPayload = domExtractionJS()
        let script = """
        tell application "\(appName)"
            try
                set theResult to execute front window's active tab javascript "\(jsPayload)"
                return theResult
            on error errMsg
                return ""
            end try
        end tell
        """
        let result = await runAppleScript(script)
        if let r = result, !r.isEmpty {
            print("[BrowserBridge] Chrome AppleScript DOM: \(r.count) chars")
            return r
        }
        print("[BrowserBridge] Chrome Automation granted but JS returned empty")
        return automationNotGrantedSentinel
    }

    private static func chromeBundleToAppName(_ bundle: String) -> String {
        if bundle.contains("brave") { return "Brave Browser" }
        if bundle.contains("edge") { return "Microsoft Edge" }
        if bundle.contains("arc") { return "Arc" }
        if bundle.contains("chromium") { return "Chromium" }
        return "Google Chrome"
    }

    /// Full-depth JS extraction: tech stack, CSS custom properties, animation keyframes,
    /// WebGL, scroll behavior, fonts, meta tags, external scripts, transitions, DOM tree.
    /// Runs inside the live rendered page via AppleScript injection.
    private static func domExtractionJS() -> String {
        let js = #"""
        (function(){
          var R={};

          // ===== 1. TECH STACK DETECTION =====
          var stack=[];
          try{
            if(window.__NEXT_DATA__)stack.push('Next.js'+(window.__NEXT_DATA__.buildId?' ('+window.__NEXT_DATA__.props?.pageProps?'App Router':'Pages Router'+')':''));
            if(window.__NUXT__||window.__NUXT_ASYNC_DATA__)stack.push('Nuxt');
            if(window.__SVELTE__)stack.push('Svelte');
            if(window.__REMIX_CONTEXT||window.__remixContext)stack.push('Remix');
            if(window.Astro)stack.push('Astro');
            if(window.__GATSBY)stack.push('Gatsby');
            if(window.React||window.__REACT_DEVTOOLS_GLOBAL_HOOK__||document.querySelector('[data-reactroot],[data-react-helmet]'))stack.push('React');
            if(window.__VUE__||window.__vue__||document.querySelector('[data-v-]'))stack.push('Vue');
            if(document.querySelector('[_nghost],[ng-version]'))stack.push('Angular');
            if(window.jQuery||window.$&&window.$.fn&&window.$.fn.jquery)stack.push('jQuery '+(window.jQuery?window.jQuery.fn.jquery:''));
            if(window.htmx)stack.push('htmx');
            if(window.Alpine)stack.push('Alpine.js');
            // Animation libs
            if(window.gsap||window.TweenMax||window.TweenLite)stack.push('GSAP');
            if(window.anime)stack.push('anime.js');
            if(window.lottie||document.querySelector('lottie-player'))stack.push('Lottie');
            if(window.MotionValue||document.querySelector('[data-framer-component-type]'))stack.push('Framer Motion');
            // 3D / WebGL
            if(window.THREE)stack.push('Three.js');
            if(window.BABYLON)stack.push('Babylon.js');
            if(window.PixiJS||window.PIXI)stack.push('PixiJS');
            if(window.Spline)stack.push('Spline');
            // CSS frameworks — detect via class patterns
            var htmlClasses=document.documentElement.className+' '+document.body.className;
            var allClasses=Array.from(document.querySelectorAll('[class]')).slice(0,100).map(e=>e.className).join(' ');
            if(/\b(flex|px-\d|py-\d|rounded|bg-|text-|w-\d|grid|gap-|space-|border-|shadow-)\b/.test(allClasses))stack.push('Tailwind CSS');
            if(document.querySelector('[class*="MuiBox"],[class*="MuiButton"]'))stack.push('Material UI');
            if(document.querySelector('.chakra-'))stack.push('Chakra UI');
            if(document.querySelector('[class*="ant-"]'))stack.push('Ant Design');
            if(document.querySelector('.bootstrap')||document.querySelector('[class*="col-md-"],[class*="col-lg-"]'))stack.push('Bootstrap');
            // Scroll libs
            if(window.Lenis||window.__lenis)stack.push('Lenis (smooth scroll)');
            if(window.LocomotiveScroll)stack.push('Locomotive Scroll');
            // State management
            if(window.__REDUX_DEVTOOLS_EXTENSION__)stack.push('Redux');
            if(window.__ZUSTAND__)stack.push('Zustand');
            // Bundler detection from scripts
            var scripts=Array.from(document.scripts).map(s=>s.src).filter(Boolean);
            if(scripts.some(s=>/\/_next\//.test(s)))stack.push('Webpack (Next)');
            else if(scripts.some(s=>/\/@vite|\.vite/.test(s)))stack.push('Vite');
            else if(scripts.some(s=>/webpack|chunk/.test(s)))stack.push('Webpack');
            // Payment / SaaS
            if(window.Stripe)stack.push('Stripe.js');
            if(window.Intercom)stack.push('Intercom');
            if(window.analytics||window.mixpanel)stack.push('Analytics ('+(window.mixpanel?'Mixpanel':'Segment')+')');
            if(window.ga||window.gtag)stack.push('Google Analytics');
          }catch(e){}
          R.techStack=stack;

          // ===== 2. CSS CUSTOM PROPERTIES (design tokens from :root) =====
          var cssVars={};
          try{
            var rootStyle=getComputedStyle(document.documentElement);
            var sheets=document.styleSheets;
            for(var i=0;i<sheets.length&&Object.keys(cssVars).length<60;i++){
              try{
                var rules=sheets[i].cssRules||[];
                for(var j=0;j<rules.length;j++){
                  if(rules[j].selectorText===':root'||rules[j].selectorText==='html'||rules[j].selectorText===':root, :host'){
                    var style=rules[j].style;
                    for(var k=0;k<style.length;k++){
                      var prop=style[k];
                      if(prop.startsWith('--')){
                        cssVars[prop]=rootStyle.getPropertyValue(prop).trim();
                      }
                    }
                  }
                }
              }catch(e){}
            }
          }catch(e){}
          R.cssVars=cssVars;

          // ===== 3. ANIMATIONS + KEYFRAMES (full detail) =====
          var animations=[];
          try{
            document.getAnimations().slice(0,30).forEach(function(a){
              var info={name:a.animationName||a.constructor.name||'transition'};
              if(a.effect&&a.effect.getTiming){
                var t=a.effect.getTiming();
                info.duration=t.duration;
                info.easing=t.easing;
                info.delay=t.delay;
                info.iterations=t.iterations;
                info.direction=t.direction;
                info.fill=t.fill;
              }
              if(a.effect&&a.effect.target){
                var el=a.effect.target;
                info.target=el.tagName+(el.id?'#'+el.id:'')+(el.className&&typeof el.className==='string'?'.'+el.className.split(' ').slice(0,2).join('.'):'');
              }
              if(a.effect&&a.effect.getKeyframes){
                try{
                  info.keyframes=a.effect.getKeyframes().map(function(kf){
                    var o={offset:kf.offset,easing:kf.easing};
                    for(var p in kf){if(p!=='offset'&&p!=='easing'&&p!=='composite'&&p!=='computedOffset')o[p]=kf[p];}
                    return o;
                  });
                }catch(e){}
              }
              animations.push(info);
            });
          }catch(e){}
          R.animations=animations;

          // ===== 4. TRANSITIONS on visible elements =====
          var transitions=[];
          try{
            document.querySelectorAll('*').forEach(function(el){
              if(transitions.length>30)return;
              var cs=getComputedStyle(el);
              var tp=cs.transitionProperty;
              if(tp&&tp!=='all'&&tp!=='none'){
                transitions.push({
                  target:el.tagName+(el.className&&typeof el.className==='string'?'.'+el.className.split(' ')[0]:''),
                  property:tp,
                  duration:cs.transitionDuration,
                  easing:cs.transitionTimingFunction,
                  delay:cs.transitionDelay
                });
              }
            });
          }catch(e){}
          R.transitions=transitions;

          // ===== 5. WebGL / CANVAS detection =====
          var canvases=[];
          try{
            document.querySelectorAll('canvas').forEach(function(c){
              var ctx=null;
              try{ctx=c.getContext('webgl2')||c.getContext('webgl')||c.getContext('experimental-webgl');}catch(e){}
              canvases.push({
                width:c.width,height:c.height,
                hasWebGL:!!ctx,
                contextType:ctx?(ctx instanceof WebGL2RenderingContext?'WebGL2':'WebGL'):'2D',
                size:Math.round(c.getBoundingClientRect().width)+'x'+Math.round(c.getBoundingClientRect().height)
              });
            });
          }catch(e){}
          R.canvases=canvases;

          // ===== 6. SCROLL BEHAVIOR =====
          try{
            var bodyCS=getComputedStyle(document.documentElement);
            R.scroll={
              behavior:bodyCS.scrollBehavior,
              snapType:bodyCS.scrollSnapType,
              overscrollBehavior:bodyCS.overscrollBehavior||bodyCS.overscrollBehaviorY,
              hasScrollSnap:!!document.querySelector('[style*="scroll-snap"]')||bodyCS.scrollSnapType!=='none'
            };
          }catch(e){R.scroll={};}

          // ===== 7. LOADED FONTS =====
          var fonts=[];
          try{
            document.fonts.forEach(function(f){
              if(f.status==='loaded')fonts.push({family:f.family,weight:f.weight,style:f.style});
            });
          }catch(e){}
          R.fonts=fonts.slice(0,20);

          // ===== 8. META TAGS =====
          var meta={};
          try{
            meta.title=document.title;
            meta.description=document.querySelector('meta[name="description"]')?.content||'';
            meta.viewport=document.querySelector('meta[name="viewport"]')?.content||'';
            meta.ogImage=document.querySelector('meta[property="og:image"]')?.content||'';
            meta.themeColor=document.querySelector('meta[name="theme-color"]')?.content||'';
            meta.charset=document.characterSet;
            meta.lang=document.documentElement.lang;
          }catch(e){}
          R.meta=meta;

          // ===== 9. EXTERNAL SCRIPTS + STYLESHEETS (CDNs, libs) =====
          R.scripts=Array.from(document.scripts).map(s=>s.src).filter(Boolean).slice(0,20);
          R.stylesheets=Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(l=>l.href).filter(Boolean).slice(0,15);

          // ===== 10. MEDIA QUERIES / RESPONSIVE BREAKPOINTS =====
          var breakpoints=new Set();
          try{
            for(var i=0;i<document.styleSheets.length;i++){
              try{
                var rules=document.styleSheets[i].cssRules||[];
                for(var j=0;j<rules.length;j++){
                  if(rules[j].type===4){
                    var mq=rules[j].conditionText||rules[j].media?.mediaText||'';
                    var match=mq.match(/(\d+)px/);
                    if(match)breakpoints.add(parseInt(match[1]));
                  }
                }
              }catch(e){}
            }
          }catch(e){}
          R.breakpoints=Array.from(breakpoints).sort(function(a,b){return a-b;}).slice(0,10);

          // ===== 11. COLOR PALETTE + FONTS (from rendered elements) =====
          var colors={},fontFamilies={};
          try{
            var els=document.querySelectorAll('*');
            for(var i=0;i<Math.min(els.length,300);i++){
              var cs=getComputedStyle(els[i]);
              var bg=cs.backgroundColor,fg=cs.color,ff=cs.fontFamily;
              if(bg&&bg!=='rgba(0, 0, 0, 0)'&&bg!=='transparent')colors[bg]=(colors[bg]||0)+1;
              if(fg)colors[fg]=(colors[fg]||0)+1;
              if(ff)fontFamilies[ff.split(',')[0].replace(/['"]/g,'').trim()]=1;
            }
          }catch(e){}
          R.colorPalette=Object.entries(colors).sort(function(a,b){return b[1]-a[1];}).slice(0,15).map(function(e){return e[0];});
          R.fontFamilies=Object.keys(fontFamilies).slice(0,8);

          // ===== 12. DOM TREE (deeper, 12 levels, with inline styles) =====
          function s(e,d){
            if(d>12||!e||!e.tagName)return'';
            var t=e.tagName.toLowerCase();
            if(['script','style','noscript','path','link','meta','head'].includes(t))return'';
            var a='',k=['id','class','role','href','src','alt','type','aria-label','placeholder','name','data-testid','data-component'];
            for(var x of k){var v=e.getAttribute(x);if(v){if(x==='class')v=v.split(' ').slice(0,8).join(' ');a+=' '+x+'=\\''+v.slice(0,120)+'\\'';}}
            var cs=getComputedStyle(e);
            var sty=[];
            var color=cs.color;if(color&&color!=='rgb(0, 0, 0)')sty.push('color:'+color);
            var bg=cs.backgroundColor;if(bg&&bg!=='rgba(0, 0, 0, 0)'&&bg!=='transparent')sty.push('bg:'+bg);
            var fs=cs.fontSize;if(fs&&fs!=='16px')sty.push('fs:'+fs);
            var fw=cs.fontWeight;if(fw&&fw!=='400')sty.push('fw:'+fw);
            var br=cs.borderRadius;if(br&&br!=='0px')sty.push('radius:'+br);
            var bs=cs.boxShadow;if(bs&&bs!=='none')sty.push('shadow:yes');
            var op=cs.opacity;if(op&&op!=='1')sty.push('opacity:'+op);
            var tr=cs.transform;if(tr&&tr!=='none')sty.push('transform:'+tr.slice(0,40));
            var pos=cs.position;if(pos&&pos!=='static')sty.push('pos:'+pos);
            var disp=cs.display;if(disp==='flex'||disp==='grid'||disp==='inline-flex'||disp==='inline-grid')sty.push('display:'+disp);
            var gap=cs.gap;if(gap&&gap!=='normal'&&gap!=='0px')sty.push('gap:'+gap);
            if(sty.length)a+=' _s=\\''+sty.join(';')+'\\'';
            var r=e.getBoundingClientRect(),sz=(r.width>5&&r.height>5?' <!--'+Math.round(r.width)+'x'+Math.round(r.height)+'-->':'');
            var kids=Array.from(e.children).filter(function(c){return!['script','style','svg','noscript'].includes(c.tagName.toLowerCase());});
            if(!kids.length){var txt=(e.textContent||'').trim().slice(0,100);return txt?'<'+t+a+'>'+txt+'</'+t+'>'+sz:'';}
            return'<'+t+a+'>'+sz+'\\n'+kids.map(function(c){return s(c,d+1);}).filter(Boolean).join('\\n')+'\\n</'+t+'>';
          }

          R.url=location.href;
          R.dom=s(document.body,0);

          return JSON.stringify(R);
        })()
        """#.replacingOccurrences(of: "\n", with: " ").replacingOccurrences(of: "\"", with: "\\\"")
        return js
    }

    // MARK: - AppleScript runner

    private static func runAppleScript(_ source: String) async -> String? {
        return await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                let script = NSAppleScript(source: source)
                var error: NSDictionary?
                let result = script?.executeAndReturnError(&error)
                if let err = error {
                    print("[BrowserBridge] AppleScript error: \(err)")
                    continuation.resume(returning: nil)
                } else {
                    continuation.resume(returning: result?.stringValue)
                }
            }
        }
    }
}
