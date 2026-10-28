// Dis Dat — MAIN-world GL hooks, injected at document_start so they beat the page's own
// WebGL init. We force preserveDrawingBuffer (so the rendered frame can be read back at any
// time), keep a registry of every linked program + its shader source, and on request hand
// back the full capture for a canvas: all programs' GLSL, a uniform snapshot, the rendered
// frame, and GL state. This is the #1 reproducibility lever — the shader source IS the look.
(() => {
  if (window.__ddHooks) return; window.__ddHooks = true;
  const realGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    let a = attrs;
    try { if (/webgl/i.test(type)) a = Object.assign({}, attrs, { preserveDrawingBuffer: true }); } catch (e) {}
    const ctx = realGetContext.call(this, type, a);
    try {
      if (ctx && /webgl/i.test(type) && !ctx.__ddWrapped) {
        ctx.__ddWrapped = true; ctx.__ddType = type; this.__ddCtx = ctx; this.__ddType = type;
        ctx.__ddPrograms = [];
        const ss = ctx.shaderSource; ctx.shaderSource = function (sh, src) { try { sh.__ddSrc = src; } catch (e) {} return ss.call(this, sh, src); };
        const lp = ctx.linkProgram; ctx.linkProgram = function (prog) { try { if (ctx.__ddPrograms.indexOf(prog) < 0) ctx.__ddPrograms.push(prog); } catch (e) {} return lp.call(this, prog); };
        // capture the image/canvas/video/gradient sources uploaded as textures — these feed the
        // shaders (e.g. a colour-ramp the look depends on) and are otherwise invisible to any scrape.
        ctx.__ddTex = []; ctx.__ddTexSeen = new WeakSet();
        const ti = ctx.texImage2D, tsi = ctx.texSubImage2D;
        ctx.texImage2D = function () { try { recordTex(ctx, arguments[arguments.length - 1]); } catch (e) {} return ti.apply(this, arguments); };
        ctx.texSubImage2D = function () { try { recordTex(ctx, arguments[arguments.length - 1]); } catch (e) {} return tsi.apply(this, arguments); };
      }
    } catch (e) {}
    return ctx;
  };

  // snapshot a texture source: a small dataURL when same-origin (the actual bytes), else the URL +
  // dims (cross-origin taints toDataURL — the agent/background can re-fetch by URL with no 403).
  function recordTex(gl, src) {
    try {
      const isImg = src && (src instanceof HTMLImageElement || src instanceof HTMLCanvasElement || src instanceof HTMLVideoElement || (window.ImageBitmap && src instanceof ImageBitmap));
      if (!isImg || !gl.__ddTex || gl.__ddTex.length >= 6 || gl.__ddTexSeen.has(src)) return;
      gl.__ddTexSeen.add(src);
      const url = src.currentSrc || src.src || null;
      const w = src.naturalWidth || src.videoWidth || src.width || 0, h = src.naturalHeight || src.videoHeight || src.height || 0;
      if (!w || !h) return;
      let dataUrl = null, tainted = false;
      try {
        const c = document.createElement('canvas'), MX = 256, sc = Math.min(1, MX / w, MX / h);
        c.width = Math.max(1, Math.round(w * sc)); c.height = Math.max(1, Math.round(h * sc));
        c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
        dataUrl = c.toDataURL('image/png');
      } catch (e) { tainted = true; }
      gl.__ddTex.push({ url, w, h, kind: src.tagName ? src.tagName.toLowerCase() : 'imagebitmap', dataUrl, tainted });
    } catch (e) {}
  }

  function captureCanvas(canvas) {
    const out = { type: canvas.__ddType || '2d', w: canvas.width, h: canvas.height, programs: [], frame: null };
    try {
      const gl = canvas.__ddCtx;
      if (!gl) { try { out.frame = canvas.toDataURL('image/png'); } catch (e) { out.frameTainted = true; } return out; } // plain 2d canvas
      const VS = gl.VERTEX_SHADER;
      const progs = (gl.__ddPrograms && gl.__ddPrograms.length) ? gl.__ddPrograms.slice() : [];
      try { const cur = gl.getParameter(gl.CURRENT_PROGRAM); if (cur && progs.indexOf(cur) < 0) progs.push(cur); } catch (e) {}
      progs.slice(0, 12).forEach(prog => {
        const P = { vertex: '', fragment: '', uniforms: [] };
        try {
          (gl.getAttachedShaders(prog) || []).forEach(sh => {
            let src = ''; try { src = gl.getShaderSource(sh) || ''; } catch (e) {} if (!src) src = sh.__ddSrc || '';
            let isV = false; try { isV = gl.getShaderParameter(sh, gl.SHADER_TYPE) === VS; } catch (e) {}
            if (isV) P.vertex = src; else P.fragment = src;
          });
          const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) || 0;
          for (let i = 0; i < Math.min(n, 64); i++) {
            try { const info = gl.getActiveUniform(prog, i); if (!info) continue; const loc = gl.getUniformLocation(prog, info.name); let v = null; try { v = gl.getUniform(prog, loc); if (v && v.length != null) v = Array.from(v).slice(0, 16); } catch (e) {} P.uniforms.push({ name: info.name, value: v }); } catch (e) {}
          }
        } catch (e) {}
        if (P.vertex || P.fragment) out.programs.push(P);
      });
      try { out.frame = canvas.toDataURL('image/png'); } catch (e) { out.frameTainted = true; }
      try { if (gl.__ddTex && gl.__ddTex.length) out.textures = gl.__ddTex.slice(0, 6); } catch (e) {}
      try { out.glState = { viewport: Array.from(gl.getParameter(gl.VIEWPORT) || []), blend: !!gl.getParameter(gl.BLEND), depthTest: !!gl.getParameter(gl.DEPTH_TEST), drawingBufferW: gl.drawingBufferWidth, drawingBufferH: gl.drawingBufferHeight }; } catch (e) {}
    } catch (e) { out.error = String(e); }
    return out;
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || !e.data.__disdat_gl_req) return;
    const tok = e.data.__disdat_gl_req; let res = null;
    try { const el = document.querySelector('[data-dd-gl-' + tok + ']'); if (el && el.tagName === 'CANVAS') res = captureCanvas(el); } catch (err) {}
    try { window.postMessage({ __disdat_gl_res: { token: tok, gl: res } }, '*'); } catch (err) {}
  });
})();
