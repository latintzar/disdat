// A bounded inference digest; the capture and its ground-truth artifacts stay complete.
(function (root) {
  'use strict';
  const INPUT_LIMIT = 2200, MAX_TOKENS = 256;
  const SYSTEM = 'Turn this UI feedback into one concise task. State only the requested outcome; leave implementation to the coding agent. Return one short sentence.';
  const STOP = new Set('a an and are as at be but by for from had has have i in is it its like make me more my of on or please than that the their them these they this those to too very want was we were with would you your'.split(' '));
  function text(value, limit) {
    const s = typeof value === 'string' ? value : Array.isArray(value) ? value.filter(x => typeof x === 'string').join(' > ') : '';
    return s.replace(/\s+/g, ' ').trim().slice(0, limit);
  }
  function excerpt(value) {
    const s = text(value, 1000000);
    return s.length <= 1000 ? s : s.slice(0, 660) + ' … ' + s.slice(-330);
  }
  function words(value) { return (text(value, 1600).toLowerCase().match(/[\p{L}\p{N}_-]+/gu) || []).filter(w => w.length > 2 && !STOP.has(w)); }
  function relevance(element, intent) {
    const label = text(element.text, 160) + ' ' + text(element.a11y?.name, 100);
    const identity = text(element.selector, 200) + ' ' + text(element.component, 100) + ' ' + text(element.a11y?.role, 40);
    const labelWords = new Set(words(label)), identityWords = words(identity).join(' ');
    const matches = intent.reduce((n, w) => n + (labelWords.has(w) ? 4 : identityWords.includes(w) ? 2 : 0), 0);
    const kinds = element.kinds || {};
    return {matches, score: matches * 100 + (kinds.click ? 12 : 0) + (kinds.type ? 16 : 0) + (kinds.focus ? 5 : 0) + Math.min(4, kinds.hover || 0)};
  }
  function target(element, transcript) {
    const out = {selector: element.selector};
    for (const [key, value, limit] of [['name', element.a11y?.name || element.text, 70], ['role', element.a11y?.role, 30],
      ['component', element.component, 70], ['source', element.source, 100]]) {
      const s = text(value, limit); if (s) out[key] = s;
    }
    const computed = element.computed || {};
    let keys = ['color', 'background-color', 'font-size'];
    if (/space|gap|padding|margin|align|layout|size|width|height/i.test(transcript)) keys = ['display', 'gap', 'padding', 'width', 'height'];
    else if (/animat|motion|move|slow|fast|transition/i.test(transcript)) keys = ['animation-duration', 'animation-timing-function', 'transition-duration'];
    else if (/font|type|text|bold|read/i.test(transcript)) keys = ['font-size', 'font-weight', 'color'];
    const styles = {};
    for (const key of keys) {
      const value = text(computed[key], 60); if (value) styles[key] = value;
      if (Object.keys(styles).length === 3) break;
    }
    if (Object.keys(styles).length) out.styles = styles;
    return out;
  }
  function build(session, elements, page) {
    let spoken = excerpt(session?.transcript);
    while (JSON.stringify(spoken).length > 1100) {
      const keep = Math.floor(spoken.length / 3);
      spoken = spoken.slice(0, keep) + ' … ' + spoken.slice(-keep);
    }
    if (!spoken) return null;
    const intent = words(spoken);
    const ranked = (elements || []).filter(e => e && typeof e.selector === 'string' && e.selector)
      .map((element, order) => ({element, order, ...relevance(element, intent)}))
      .sort((a, b) => b.score - a.score || a.order - b.order);
    const matched = ranked.filter(e => e.matches > 0);
    const general = /\b(page|site|overall|everything)\b/i.test(spoken);
    const selected = matched.length ? matched.slice(0, 3) : general ? [] : ranked.slice(0, 1);
    const context = {page: typeof page === 'string' ? page : (session?.pages?.at(-1) || ''), targets: []};
    for (const {element} of selected) {
      const fact = target(element, spoken);
      if (JSON.stringify({...context, targets: context.targets.concat(fact)}).length > INPUT_LIMIT) break;
      context.targets.push(fact);
    }
    const labels = context.targets.map(fact => fact.name || fact.role || 'engaged element').join('; ');
    const input = (labels ? 'Element: ' + text(labels, 240) + '\n' : '') + 'Feedback: ' + spoken;
    return {sys: SYSTEM, input, maxTokens: MAX_TOKENS, context};
  }
  function format(request, prose) {
    const context = request.context, lines = [context.page, (prose || '').trim()].filter(Boolean);
    if (context.targets.length) lines.push('Observed current facts:\n' + context.targets.map(fact => [
      fact.selector, fact.component && '<' + fact.component + '>', fact.source,
      ...Object.entries(fact.styles || {}).map(([key, value]) => key + ': ' + value)
    ].filter(Boolean).join(' · ')).join('\n'));
    return lines.join('\n\n');
  }

  root.DisdatLocalBriefing = Object.freeze({build, format, INPUT_LIMIT, MAX_TOKENS});
  if (typeof module !== 'undefined' && module.exports) module.exports = root.DisdatLocalBriefing;
})(typeof globalThis === 'undefined' ? self : globalThis);
