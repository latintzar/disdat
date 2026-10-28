import React, { useEffect, useRef, useState } from 'react'


const P = {
  k: '#16110D', // ink
  w: '#FBF7EE', // cream
  o: '#FF5C2A', // orange
  y: '#FFB400', // yellow
}

const SOURCE_URL = 'https://github.com/latintzar/disdat'

function EyebrowBar() {
  return null
}

function VisionEmbed() {
  const ref = useRef(null)
  useEffect(() => {
    const f = ref.current; if (!f) return
    const fit = () => { try { const d = f.contentDocument; if (d && d.body) f.style.height = d.documentElement.scrollHeight + 'px' } catch {} }
    f.addEventListener('load', fit); const iv = window.setInterval(fit, 800)
    return () => { f.removeEventListener('load', fit); window.clearInterval(iv) }
  }, [])
  return <iframe ref={ref} id="demos" src="/research-vision.html#embed" title="Dis Dat" scrolling="no" style={{ width: '100%', border: 0, display: 'block', background: '#FBF7EE' }} />
}

export default function DisDat() {
  return (
    <div className="min-h-screen bg-[#FBF7EE] text-[#16110D]" style={{ fontFamily: "'Inter', -apple-system, sans-serif" }}>
      <GlobalStyle />
      <EyebrowBar />
      <Nav />
      <VisionEmbed />
      <Footer />
    </div>
  )
}

function GlobalStyle() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700;9..144,900&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
      .display { font-family: 'Fraunces', serif; font-optical-sizing: auto; }
      .mono { font-family: 'JetBrains Mono', monospace; }
      .pixelated { image-rendering: pixelated; shape-rendering: crispEdges; }
      .warm-bg { background-color:#FBF7EE; background-image:
        radial-gradient(at 18% 0%, rgba(255,92,42,0.05) 0%, transparent 50%),
        radial-gradient(at 82% 100%, rgba(255,180,0,0.05) 0%, transparent 50%); }
      .grain { background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.4'/%3E%3C/svg%3E"); }
      .dot-grid { background-image: radial-gradient(rgba(22,17,13,0.10) 1px, transparent 1.6px); background-size: 18px 18px; background-position: -9px -9px; }
      .ribbon { position:absolute; top:20px; right:-36px; width:150px; text-align:center; transform:rotate(45deg); background:#FF5C2A; color:#fff; padding:5px 0; font-size:10px; font-weight:700; letter-spacing:0.14em; text-transform:uppercase; box-shadow:0 6px 16px rgba(255,92,42,0.35); }
      @keyframes pulse-record { 0%,100%{opacity:1} 50%{opacity:.3} }
      .pulse-record { animation: pulse-record 1.4s ease-in-out infinite; }
      @keyframes fade-up { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
      .fade-up { animation: fade-up .35s ease-out both; }
      @keyframes blink { 0%,49%{opacity:1} 50%,100%{opacity:0} }
      .blink { animation: blink 1s steps(1) infinite; }
      @keyframes ddProBounce { 0%,100%{transform:translateY(0);box-shadow:0 6px 0 #b33a17} 50%{transform:translateY(-7px);box-shadow:0 13px 0 #b33a17} }
      @keyframes marker-pop { 0%{transform:translate(-50%,-50%) scale(0);opacity:0} 60%{transform:translate(-50%,-50%) scale(1.25)} 100%{transform:translate(-50%,-50%) scale(1);opacity:1} }
      .marker-pop { animation: marker-pop .35s cubic-bezier(.34,1.56,.64,1) both; }
      @keyframes ripple { 0%{transform:translate(-50%,-50%) scale(.3);opacity:.6} 100%{transform:translate(-50%,-50%) scale(2.4);opacity:0} }
      .ripple { animation: ripple .6s ease-out forwards; }
      @keyframes radar { 0%{transform:scale(.45);opacity:.7} 100%{transform:scale(2.7);opacity:0} }
      .radar { animation: radar 1.15s ease-out forwards; }
      @keyframes pop { 0%{transform:scale(0)} 60%{transform:scale(1.22)} 100%{transform:scale(1)} }
      .pop { animation: pop .34s cubic-bezier(.34,1.56,.64,1) both; }
      @keyframes capture-flash { 0%{opacity:0} 22%{opacity:1} 100%{opacity:0} }
      .capture-flash { animation: capture-flash .5s ease-out forwards; }
      @keyframes packet { 0%{left:0%;opacity:0} 12%{opacity:1} 82%{opacity:1} 100%{left:50%;opacity:0} }
      .packet { animation: packet 1.2s ease-in forwards; }
      @keyframes tick-pop { 0%{transform:translate(-50%,-50%) scale(0);opacity:0} 55%{transform:translate(-50%,-50%) scale(1.18);opacity:1} 100%{transform:translate(-50%,-50%) scale(1);opacity:1} }
      .tick-pop { animation: tick-pop .42s cubic-bezier(.34,1.56,.64,1) both; }
      @keyframes beam-h { 0%{left:-6%;opacity:0} 14%{opacity:1} 86%{opacity:1} 100%{left:106%;opacity:0} }
      .beam-h { animation: beam-h 1.1s cubic-bezier(.45,0,.55,1) forwards; }
      @keyframes beam-v { 0%{top:-6%;opacity:0} 14%{opacity:1} 86%{opacity:1} 100%{top:106%;opacity:0} }
      .beam-v { animation: beam-v 1.1s cubic-bezier(.45,0,.55,1) forwards; }
      @keyframes notif-in { 0%{opacity:0;transform:translateY(-10px) scale(.96)} 100%{opacity:1;transform:none} }
      .notif-in { animation: notif-in .5s cubic-bezier(.2,.8,.2,1) both; }
      @keyframes notif-rise { 0%{opacity:0;transform:translate(-50%,22px) scale(.94)} 100%{opacity:1;transform:translate(-50%,0) scale(1)} }
      .notif-rise { animation: notif-rise .55s cubic-bezier(.2,.85,.25,1) both; }
      @keyframes flow-dash { to { stroke-dashoffset: -18; } }
      .flow-dash { animation: flow-dash .55s linear infinite; }
      @keyframes flow-packet { 0%{offset-distance:0%;opacity:0} 12%{opacity:1} 88%{opacity:1} 100%{offset-distance:100%;opacity:0} }
      @keyframes notif-up { 0%{opacity:0;transform:translate(-50%,16px) scale(.97)} 100%{opacity:1;transform:translate(-50%,0) scale(1)} }
      .notif-up { animation: notif-up .5s cubic-bezier(.2,.8,.2,1) both; }
      @keyframes float-slow { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
      .float-slow { animation: float-slow 5s ease-in-out infinite; }
      @keyframes agent-in { 0%{opacity:0;transform:translateY(0.4em)} 100%{opacity:1;transform:translateY(0)} }
      .agent-in { animation: agent-in .42s cubic-bezier(.2,.8,.2,1) both; }
      @keyframes glideA { 0%,100%{transform:translate(0,0)} 50%{transform:translate(34px,-20px)} }
      @keyframes glideB { 0%,100%{transform:translate(0,0)} 50%{transform:translate(-26px,22px)} }
      @keyframes glideC { 0%,100%{transform:translate(0,0)} 50%{transform:translate(22px,18px)} }
      .glideA { animation: glideA 6s ease-in-out infinite; }
      .glideB { animation: glideB 7.5s ease-in-out infinite; }
      .glideC { animation: glideC 5.5s ease-in-out infinite; }
      @keyframes glow-pulse { 0%,100%{opacity:.5;transform:scale(1)} 50%{opacity:.85;transform:scale(1.12)} }
      .glow-pulse { animation: glow-pulse 3s ease-in-out infinite; }
      @keyframes wv0 { 0%,100%{transform:scaleY(.3)} 50%{transform:scaleY(1)} }
      @keyframes wv1 { 0%,100%{transform:scaleY(.6)} 50%{transform:scaleY(.2)} }
      @keyframes wv2 { 0%,100%{transform:scaleY(.4)} 50%{transform:scaleY(.9)} }
      @keyframes wv3 { 0%,100%{transform:scaleY(.8)} 50%{transform:scaleY(.35)} }
      @keyframes wv4 { 0%,100%{transform:scaleY(.25)} 50%{transform:scaleY(.7)} }
      .wv-bar { transform-origin: center; display:inline-block; }
      @keyframes marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
      .marquee { animation: marquee 38s linear infinite; will-change: transform; }
      .marquee:hover { animation-play-state: paused; }
      @keyframes scene-in { 0%{opacity:0;transform:scale(.985)} 100%{opacity:1;transform:scale(1)} }
      .scene-in { animation: scene-in .55s cubic-bezier(.2,.7,.2,1) both; }
      @keyframes slide-down-btn { 0%{transform:translate(-50%,-160%)} 100%{transform:translate(-50%,0)} }
      .slide-down-btn { animation: slide-down-btn 1.1s cubic-bezier(.34,1.2,.5,1) forwards; }
      @media (prefers-reduced-motion: reduce) {
        .pulse-record, .blink, .float-slow, .glideA, .glideB, .glideC,
        .glow-pulse, .wv-bar, .marquee { animation: none !important; }
        .fade-up, .scene-in, .marker-pop, .slide-down-btn { animation-duration: .01ms !important; }
        .ripple { animation: none !important; opacity: 0 !important; }
      }
    `}</style>
  )
}

const cursorArt = [
  'k...........',
  'kk..........',
  'kwk.........',
  'kwwk........',
  'kwwwk.......',
  'kwwwwk......',
  'kwwwwwk.....',
  'kwwwwwwk....',
  'kwwwwwwwk...',
  'kwwwwwwwwk..',
  'kwwwwwwwwwk.',
  'kwwwwwooook.',
  'kwwwookk....',
  'kwwok.kk....',
  'kwok...kk...',
  'kkk.....k...',
]

const cursorPal: Record<string, string> = { '.': 'transparent', k: P.k, w: P.w, o: P.o }

function PixelCursor({ scale = 2, dark = false, outline = false, className = '' }: { scale?: number; dark?: boolean; outline?: boolean; className?: string }) {
  const rows = cursorArt.length
  const cols = cursorArt[0].length
  // dark = solid black silhouette (like the logo) with the orange accent kept.
  const pal: Record<string, string> = dark ? { '.': 'transparent', k: P.k, w: P.k, o: P.o } : cursorPal
  // `outline` = a thin, uniform light outline on EVERY side (an 8-direction white
  // drop-shadow stack, not the jagged pixel halo) so the dark pointer stays crisp
  // on any background.
  const o = '0.7px'
  const outlineFilter = outline
    ? `drop-shadow(${o} 0 0 #fff) drop-shadow(-${o} 0 0 #fff) drop-shadow(0 ${o} 0 #fff) drop-shadow(0 -${o} 0 #fff) drop-shadow(${o} ${o} 0 #fff) drop-shadow(-${o} ${o} 0 #fff) drop-shadow(${o} -${o} 0 #fff) drop-shadow(-${o} -${o} 0 #fff)`
    : undefined
  return (
    <svg width={cols * scale} height={rows * scale}
      viewBox={`0 0 ${cols} ${rows}`}
      className={`pixelated ${className}`} shapeRendering="crispEdges"
      style={outlineFilter ? { filter: outlineFilter } : undefined}>
      {cursorArt.map((row, y) =>
        row.split('').map((ch, x) => {
          const fill = pal[ch]
          return fill && fill !== 'transparent' ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={fill} /> : null
        }),
      )}
    </svg>
  )
}

function Logo({ withText = true, small = false, framed = false }: { withText?: boolean; small?: boolean; framed?: boolean }) {
  const tile = small ? 26 : 34
  const scale = small ? 1.6 : 2
  return (
    <div className="flex items-center gap-2">
      {framed ? (
        <div className="rounded-lg bg-[#FBF7EE] border border-[#16110D]/15 flex items-center justify-center" style={{ width: tile, height: tile }}>
          <PixelCursor dark scale={small ? 1.4 : 1.8} />
        </div>
      ) : (
        <span className="flex items-center justify-center" style={{ width: tile, height: tile }}>
          <PixelCursor dark scale={scale} />
        </span>
      )}
      {withText && <span className="display font-semibold tracking-tight" style={{ fontSize: small ? 18 : 22 }}>Dis Dat</span>}
    </div>
  )
}

function Nav() {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return (
    <nav className="sticky top-0 z-40">
      {/* Full-bleed bar background — fades out on scroll. Opacity is a
          compositor-only property, so this never triggers layout/paint jank. */}
      <div
        className="absolute inset-0 bg-[#FBF7EE]/90 backdrop-blur border-b border-[#16110D]/5 transition-opacity duration-300 ease-out"
        style={{ opacity: scrolled ? 0 : 1 }}
        aria-hidden
      />
      {/* Content row — always centred; morphs into a pill on scroll. Only
          interpolatable properties change (max-width tweens rem→rem, padding,
          margin, colours, shadow), so the morph stays buttery smooth. */}
      <div
        className={`relative mx-auto flex items-center justify-between rounded-full transition-all duration-300 ease-out transform-gpu will-change-[max-width,padding] ${
          scrolled
            ? 'mt-4 max-w-2xl px-4 py-2 bg-[#FBF7EE]/85 backdrop-blur-xl border border-[#16110D]/10 shadow-[0_8px_30px_rgba(22,17,13,0.06)]'
            : 'mt-0 max-w-6xl px-6 lg:px-10 py-3.5 bg-transparent border border-transparent'
        }`}
      >
        <Logo />
        <div className="hidden md:flex items-center gap-6 text-sm">
          <a href={SOURCE_URL} className="hover:opacity-60 transition">Source</a>
          <a href="/download" className="bg-[#16110D] text-[#FBF7EE] px-4 py-2 text-sm rounded-full font-medium hover:bg-[#FF5C2A] transition">Install</a>
        </div>
        <div className="md:hidden flex items-center gap-4">
          <a href={SOURCE_URL} className="text-sm hover:opacity-60 transition">Source</a>
          <a href="/download" className="bg-[#16110D] text-[#FBF7EE] px-4 py-2 rounded-full text-sm font-medium">Install</a>
        </div>
      </div>
    </nav>
  )
}

function Footer() {
  return (
    <footer className="border-t border-[#16110D]/10 py-8 px-5 bg-[#FBF7EE]">
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-4 text-sm text-[#16110D]/50">
        <Logo small />
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <a href="/download" className="hover:text-[#16110D]">Install</a>
          <a href={SOURCE_URL} className="hover:text-[#16110D]">Source</a>
          <a href={`${SOURCE_URL}/blob/main/docs/configuration.md`} className="hover:text-[#16110D]">Data flow</a>
          <a href={`${SOURCE_URL}/blob/main/LICENSE`} className="hover:text-[#16110D]">MIT licence</a>
          <a href="mailto:peter@disdat.dev" className="hover:text-[#16110D]">peter@disdat.dev</a>
        </div>
      </div>
    </footer>
  )
}
