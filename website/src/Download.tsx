import React from 'react';
const SOURCE_URL='https://github.com/latintzar/disdat';
const DOWNLOAD_URL='https://github.com/latintzar/disdat/releases/latest/download/disdat-extension.zip';
const INSTALL_URL=DOWNLOAD_URL;
function Shell({ children, wide = false, sourceInstall = false }: { children: React.ReactNode; wide?: boolean; sourceInstall?: boolean }) {
  return (
    <div className="min-h-screen bg-[#FBF7EE] text-[#16110D]" style={{ fontFamily: "'Inter',-apple-system,sans-serif" }}>
      <header className="sticky top-0 z-30 bg-[#FBF7EE]/90 backdrop-blur border-b border-[#16110D]/5">
        <div className="max-w-6xl mx-auto px-5 py-3.5 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2">
            {/* Just the cursor — no plate. The framed (cream-tile) mark is reserved for app-icon contexts. */}
            <img src="/favicon-32.png" alt="" width={26} height={26} className="pixelated" style={{ imageRendering: 'pixelated' }} />
            <span className="display font-semibold tracking-tight text-lg">DisDat</span>
          </a>
          <div className="flex items-center gap-3"><a href={SOURCE_URL} className="text-sm font-medium hover:text-[#FF5C2A]">GitHub</a>
          <a href={INSTALL_URL} className="bg-[#16110D] text-[#FBF7EE] px-4 py-2 rounded-full text-sm font-medium hover:bg-[#FF5C2A] transition">Download extension</a></div>
        </div>
      </header>
      <main className={`mx-auto px-5 py-12 md:py-16 ${wide ? 'max-w-5xl' : 'max-w-2xl'}`}>{children}</main>
      <footer className="border-t border-[#16110D]/10 py-8 px-5 text-center text-sm text-[#16110D]/50"><a href="https://atelierneyra.com">made by atelier neyra</a></footer>
    </div>
  )
}
export function Download() {
  return (
    <Shell sourceInstall>
      <a href="/" className="mono text-xs text-[#FF5C2A] hover:underline">← Back to home</a>
      <div className="pt-8 max-w-lg mx-auto text-center">
        <img src="/icon-1024.png" alt="" width={84} height={84} className="mx-auto rounded-[20px] shadow-lg mb-6" />
        <h1 className="display text-4xl md:text-5xl font-medium tracking-tight mb-3">Download the Chrome extension</h1>
        <p className="text-[#16110D]/60 mb-8">Unzip and load the folder in Chrome. Whisper transcribes your voice and Qwen connects your feedback to the captured page, on your device.</p>
        <a href={DOWNLOAD_URL} className="inline-flex bg-[#FF5C2A] text-white px-8 py-4 rounded-full font-semibold text-lg hover:bg-[#16110D] transition">Download extension</a>
        <div className="rounded-2xl border border-[#16110D]/10 bg-white p-6 text-left mt-8">
          <p className="font-semibold mb-3">Give your agent this instruction</p>
          <p className="mono text-sm text-[#16110D]/75 break-words">Read {SOURCE_URL}/blob/main/skills/disdat-setup/SKILL.md and install DisDat in local mode. Use the capture skill to work from my recordings.</p>
        </div>
        <ol className="text-left space-y-3 mt-10">
          {['Download and unzip the extension.', 'In chrome://extensions, enable Developer mode and load the disdat-extension folder with Load unpacked.', 'Allow microphone access and start recording. The first recording downloads Qwen and Whisper; Chrome with WebGPU and space for the models is required.', 'Talk over the page, then Stop. Give your agent the briefing and downloaded capture.'].map((t, i) => (
            <li key={i} className="flex gap-3 items-start text-[15px] text-[#16110D]/75"><span className="mono text-[#FF5C2A] font-semibold">{i + 1}.</span><span>{t}</span></li>
          ))}
        </ol>
        <p className="text-sm text-[#16110D]/60 mt-8">Optional cloud mode uses your own Deepgram and Groq or Anthropic keys. Your agent configures them through private local input.</p>
        <a className="inline-block text-sm text-[#FF5C2A] underline mt-4" href={`${SOURCE_URL}/blob/main/docs/configuration.md`}>Configuration and data flow</a>
      </div>
    </Shell>
  )
}
