// A faster drop-in for makefun-site 1.0.0: run(input) returns byte-for-byte the answer
// makefun-site's build returns, but without its per-character regex work.
// Written from the reference's rules (README.md) and behaviour (its code is the
// reference wherever the two differ). No dependencies, no I/O, no clock, no randomness.

const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ESCAPABLE = new Set(['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']);
const RESERVED = ['posts', 'tags', 'page'];

/** Whitespace in JavaScript's \s sense (for word counts and list continuations). */
function isWSCode(c) {
  return c === 9 || c === 10 || c === 11 || c === 12 || c === 13 || c === 32 || c === 160 || c === 5760 ||
    (c >= 8192 && c <= 8202) || c === 8232 || c === 8233 || c === 8239 || c === 8287 || c === 12288 || c === 65279;
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const ESC_RE = /[&<>"']/g;
const ESC_TEST = /[&<>"']/;

/** HTML escaping: & < > " ' only. */
function esc(s) {
  return ESC_TEST.test(s) ? s.replace(ESC_RE, (c) => ESCAPES[c]) : s;
}

/** The slug of `text`, cached per case; ASCII takes a tight loop, anything else the reference path. */
function slugify(text, ctx) {
  const hit = ctx.slugCache.get(text);
  if (hit !== undefined) return hit;
  let out = '';
  let gap = false;
  let ascii = true;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c > 127) { ascii = false; break; }
    let keep = -1;
    if (c >= 65 && c <= 90) keep = c + 32;
    else if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) keep = c;
    if (keep === -1) { gap = out.length > 0; continue; }
    if (gap) out += '-';
    gap = false;
    out += String.fromCharCode(keep);
  }
  let r;
  if (ascii) {
    if (out.length > 64) out = out.slice(0, 64);
    let e = out.length;
    while (e > 0 && out.charCodeAt(e - 1) === 45) e--;
    if (e !== out.length) out = out.slice(0, e);
    r = out === '' ? 'untitled' : out;
  } else {
    const plain = text.normalize('NFKD').replace(/\p{M}/gu, '');
    out = '';
    gap = false;
    for (const ch of plain) {
      let keep = null;
      if (ch >= 'A' && ch <= 'Z') keep = ch.toLowerCase();
      else if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) keep = ch;
      if (keep === null) { gap = out.length > 0; continue; }
      if (gap) out += '-';
      gap = false;
      out += keep;
    }
    out = out.slice(0, 64).replace(/-+$/, '');
    r = out === '' ? 'untitled' : out;
  }
  ctx.slugCache.set(text, r);
  return r;
}

function uniqueSlug(slug, taken) {
  let out = slug;
  for (let n = 2; taken.has(out); n++) out = `${slug}-${n}`;
  taken.add(out);
  return out;
}

function longDate(date, ctx) {
  let v = ctx.dateCache.get(date);
  if (v === undefined) {
    const p = date.split('-');
    v = `${Number(p[2])} ${MONTHS[Number(p[1]) - 1]} ${p[0]}`;
    ctx.dateCache.set(date, v);
  }
  return v;
}

/** A line of only spaces/tabs (or empty). */
function isBlank(s) {
  if (s.length === 0) return true;
  const c0 = s.charCodeAt(0);
  if (c0 !== 32 && c0 !== 9) return false;
  for (let i = 1; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

/** Spaces/tabs at either end dropped. */
function trimLine(line) {
  let a = 0;
  let b = line.length;
  while (a < b && (line.charCodeAt(a) === 32 || line.charCodeAt(a) === 9)) a++;
  while (b > a && (line.charCodeAt(b - 1) === 32 || line.charCodeAt(b - 1) === 9)) b--;
  if (a === 0 && b === line.length) return line;
  return line.slice(a, b);
}

// ---------------------------------------------------------------- front matter

const KEYS = new Set(['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary']);

function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

function stringOf(raw) {
  if (raw.charCodeAt(0) === 34) {
    if (raw.length < 2 || raw.charCodeAt(raw.length - 1) !== 34) return { error: 'a quoted string is not closed' };
    let out = '';
    for (let i = 1; i < raw.length - 1; i++) {
      const c = raw[i];
      if (c === '\\') {
        const n = raw[i + 1];
        if ((n !== '"' && n !== '\\') || i + 1 === raw.length - 1) return { error: 'a quoted string holds an escape other than \\" or \\\\' };
        out += n;
        i++;
      } else if (c === '"') return { error: 'a quoted string holds a stray quote' };
      else out += c;
    }
    return { value: out };
  }
  if (raw.charCodeAt(0) === 91) return { error: 'a bare string opens on [' };
  return { value: raw };
}

function valueOf(key, raw) {
  switch (key) {
    case 'title':
    case 'summary': {
      const s = stringOf(raw);
      return 'error' in s ? { error: `key "${key}": ${s.error}` } : s;
    }
    case 'date': {
      let ok = raw.length === 10 && raw.charCodeAt(4) === 45 && raw.charCodeAt(7) === 45;
      let y = 0, mo = 0, d = 0;
      if (ok) {
        for (let i = 0; i < 10; i++) {
          if (i === 4 || i === 7) continue;
          const c = raw.charCodeAt(i);
          if (c < 48 || c > 57) { ok = false; break; }
        }
      }
      if (ok) {
        y = (raw.charCodeAt(0) - 48) * 1000 + (raw.charCodeAt(1) - 48) * 100 + (raw.charCodeAt(2) - 48) * 10 + (raw.charCodeAt(3) - 48);
        mo = (raw.charCodeAt(5) - 48) * 10 + (raw.charCodeAt(6) - 48);
        d = (raw.charCodeAt(8) - 48) * 10 + (raw.charCodeAt(9) - 48);
        if (y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) ok = false;
      }
      if (!ok) return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      return { value: raw };
    }
    case 'tags': {
      if (raw.charCodeAt(0) !== 91 || raw.charCodeAt(raw.length - 1) !== 93) return { error: 'key "tags": not a list [a, b]' };
      const inner = raw.slice(1, -1);
      if (inner.trim() === '') return { value: [] };
      const tags = inner.split(',').map((t) => t.trim());
      for (const t of tags) {
        if (t === '' || t.indexOf('"') !== -1 || t.indexOf('[') !== -1 || t.indexOf(']') !== -1) {
          return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
        }
      }
      return { value: tags };
    }
    case 'draft':
      return raw === 'true' ? { value: true } : raw === 'false' ? { value: false } : { error: 'key "draft": true or false' };
    case 'layout': {
      let ok = raw.length > 0;
      for (let i = 0; ok && i < raw.length; i++) {
        const c = raw.charCodeAt(i);
        if (!((c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45)) ok = false;
      }
      return ok ? { value: raw } : { error: 'key "layout": not a template name' };
    }
    case 'slug': {
      let ok = raw.length > 0 && raw.length <= 64;
      let prevDash = true; // first char must be alnum: a leading '-' fails
      for (let i = 0; ok && i < raw.length; i++) {
        const c = raw.charCodeAt(i);
        if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) prevDash = false;
        else if (c === 45 && !prevDash) prevDash = true;
        else ok = false;
      }
      if (prevDash) ok = false; // trailing '-' (or empty) fails
      return ok ? { value: raw } : { error: 'key "slug": not a slug' };
    }
    default:
      return { error: `unknown key "${key}"` };
  }
}

function parseFrontMatter(text) {
  const lines = text.split('\n');
  if (lines[0] !== '---') return { error: 'no front matter' };
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') { close = i; break; }
  }
  if (close === -1) return { error: 'the front matter is not closed' };
  const data = {};
  for (let i = 1; i < close; i++) {
    const line = lines[i];
    if (isBlank(line) || line.charCodeAt(0) === 35) continue;
    let k = 0;
    while (k < line.length) {
      const c = line.charCodeAt(k);
      if ((c >= 97 && c <= 122) || c === 95) k++;
      else break;
    }
    if (k === 0 || line.charCodeAt(k) !== 58) return { error: `line ${i + 1} is not "key: value"` };
    const key = line.slice(0, k);
    const rest = line.slice(k + 1);
    let raw;
    if (rest === '') raw = '';
    else if (rest.charCodeAt(0) === 32) raw = rest.slice(1);
    else return { error: `line ${i + 1} is not "key: value"` };
    let e = raw.length;
    while (e > 0) {
      const c = raw.charCodeAt(e - 1);
      if (c === 32 || c === 9) e--;
      else break;
    }
    if (e !== raw.length) raw = raw.slice(0, e);
    if (!KEYS.has(key)) return { error: `unknown key "${key}"` };
    if (Object.hasOwn(data, key)) return { error: `key "${key}" is given twice` };
    if (raw === '') return { error: `key "${key}" has no value` };
    const v = valueOf(key, raw);
    if ('error' in v) return v;
    data[key] = v.value;
  }
  if (!Object.hasOwn(data, 'title')) return { error: 'no title' };
  return { data, lines, close };
}

// ---------------------------------------------------------------- Markdown

function isLangChar(c) {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 43 || c === 45;
}

/** Fence-open line: the language, or null. */
function fenceOpen(line) {
  if (!line.startsWith('```')) return null;
  let j = 3;
  while (j < line.length && isLangChar(line.charCodeAt(j))) j++;
  const lang = line.slice(3, j);
  while (j < line.length) {
    const c = line.charCodeAt(j);
    if (c !== 32 && c !== 9) return null;
    j++;
  }
  return lang;
}

function fenceClose(line) {
  if (!line.startsWith('```')) return false;
  for (let j = 3; j < line.length; j++) {
    const c = line.charCodeAt(j);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

function headingOf(line) {
  let d = 0;
  while (d < 6 && line.charCodeAt(d) === 35) d++;
  if (d === 0 || d >= line.length) return null;
  const c = line.charCodeAt(d);
  if (c !== 32 && c !== 9) return null;
  let s = d;
  while (s < line.length && (line.charCodeAt(s) === 32 || line.charCodeAt(s) === 9)) s++;
  let e = line.length;
  while (e > s && (line.charCodeAt(e - 1) === 32 || line.charCodeAt(e - 1) === 9)) e--;
  if (e === s) return null;
  return { depth: d, text: line.slice(s, e) };
}

function isHR(line) {
  if (line.length < 3) return false;
  const a = line.charCodeAt(0);
  const b = line.charCodeAt(1);
  const c = line.charCodeAt(2);
  if (!((a === 45 && b === 45 && c === 45) || (a === 42 && b === 42 && c === 42))) return false;
  for (let j = 3; j < line.length; j++) {
    const ch = line.charCodeAt(j);
    if (ch !== 32 && ch !== 9) return false;
  }
  return true;
}

function bulletOf(line) {
  if (line.length >= 2) {
    const c0 = line.charCodeAt(0);
    if ((c0 === 45 || c0 === 42) && line.charCodeAt(1) === 32) return line.slice(2);
  }
  return null;
}

function orderedOf(line) {
  let j = 0;
  while (j < 9 && j < line.length) {
    const c = line.charCodeAt(j);
    if (c < 48 || c > 57) break;
    j++;
  }
  if (j === 0) return null;
  if (line.charCodeAt(j) !== 46 || line.charCodeAt(j + 1) !== 32) return null;
  return { num: Number(line.slice(0, j)), text: line.slice(j + 2) };
}

function isContinued(line) {
  if (line.charCodeAt(0) !== 32 || line.charCodeAt(1) !== 32) return false;
  let j = 2;
  while (j < line.length && line.charCodeAt(j) === 32) j++;
  return j < line.length && !isWSCode(line.charCodeAt(j));
}

function endsParagraph(line) {
  if (line.length === 0) return true;
  const c0 = line.charCodeAt(0);
  if (c0 === 32 || c0 === 9) return isBlank(line);
  if (c0 === 96) return fenceOpen(line) !== null;
  if (c0 === 35) return headingOf(line) !== null;
  if (c0 === 45 || c0 === 42) return isHR(line);
  return false;
}

/** Inline action per ASCII code: 0 plain, 1 whitespace, 2 backslash, 3 backtick, 4 star, 5 bracket, 6 HTML-escape char. */
const INLINE_ACT = new Uint8Array(128);
INLINE_ACT[32] = 1;
INLINE_ACT[9] = 1;
INLINE_ACT[10] = 1;
INLINE_ACT[13] = 1;
INLINE_ACT[11] = 1;
INLINE_ACT[12] = 1;
INLINE_ACT[92] = 2;
INLINE_ACT[96] = 3;
INLINE_ACT[42] = 4;
INLINE_ACT[91] = 5;
INLINE_ACT[38] = 6;
INLINE_ACT[60] = 6;
INLINE_ACT[62] = 6;
INLINE_ACT[34] = 6;
INLINE_ACT[39] = 6;
const INLINE_TEST = /[\\`*\[&<>"']/;

/** Regex finders for inline closers. An escape pair is `\\` + any character; the
 * reference's finders skip a pair only when its second character is escapable,
 * but the characters we search for (`*`, `]`) are all escapable, so skipping any
 * pair can never hide or invent a match: a non-escapable second character can
 * never start one. The regex therefore finds exactly the reference's index. */
const ESC_OR_DSTAR = /\\.|\*\*/g;
const ESC_OR_BRACKET = /\\.|\]/g;
const ESC_OR_STARS = /\\.|\*\*|\*/g;

/** First `**` from `from` outside an escape (or -1); the caller bounds it by `hi`. */
function findStrongClose(s, from, hi) {
  ESC_OR_DSTAR.lastIndex = from;
  let m;
  while ((m = ESC_OR_DSTAR.exec(s)) !== null) {
    if (m.index >= hi) return -1;
    if (m[0] === '**') return m.index;
  }
  return -1;
}

/** First `]` from `from` outside an escape (or -1); the caller bounds it by `hi`. */
function findBracketClose(s, from, hi) {
  ESC_OR_BRACKET.lastIndex = from;
  let m;
  while ((m = ESC_OR_BRACKET.exec(s)) !== null) {
    if (m.index >= hi) return -1;
    if (m[0] === ']') return m.index;
  }
  return -1;
}

/** First single `*` from `from` (one whose run is not `**`), outside an escape, or -1. */
function findSingleStar(s, from, hi) {
  ESC_OR_STARS.lastIndex = from;
  let m;
  while ((m = ESC_OR_STARS.exec(s)) !== null) {
    if (m.index >= hi) return -1;
    if (m[0] === '*') return m.index;
  }
  return -1;
}

function hasWS(s) {
  return /\s/.test(s);
}

/** Words in `s`: its maximal runs of non-whitespace (JS \s is exactly isWSCode's set). */
const WORD_RE = /\S+/g;
function countWords(s) {
  const m = s.match(WORD_RE);
  return m === null ? 0 : m.length;
}

/**
 * `s` rendered inline; `env.link(target)` is a link's href. `wc` counts its words.
 * Word counting is done up front with one regex pass: the old per-character scan
 * counted exactly the maximal non-whitespace runs of `s` (every character of `s`
 * is visited once for counting, delimiters included, and a closing delimiter of a
 * parsed span counts exactly when it starts a new run), so runs(s) is identical.
 * The render itself is driven by one regex that jumps between special characters,
 * so plain text is sliced in bulk instead of walked character by character.
 */
/** Shared scratch for inline(): inline() is never re-entered (its recursion stays
 * inside inlineInto, which takes the same array), so one array serves every call
 * instead of allocating one per block of text. */
const INLINE_PARTS = [];
function inline(s, env, wc) {
  if (wc === undefined) wc = { n: 0, inWord: false };
  wc.n += countWords(s);
  // No inline mark and nothing to escape: the text is itself.
  if (!INLINE_TEST.test(s)) return s;
  INLINE_PARTS.length = 0;
  inlineInto(s, env, 0, s.length, INLINE_PARTS);
  return INLINE_PARTS.join('');
}

/** Next special character for the inline scan (shared; save/restore lastIndex across recursion). */
const INLINE_NEXT = /[\\`*\[&<>"']/g;

/** `s[lo..hi)` rendered inline into `parts` (no word counting; the caller counted runs). */
function inlineInto(s, env, lo, hi, parts) {
  let run = lo;
  INLINE_NEXT.lastIndex = lo;
  let m;
  while ((m = INLINE_NEXT.exec(s)) !== null) {
    const p = m.index;
    if (p >= hi) break;
    const c = m[0];
    if (c === '\\') {
      if (p + 1 < hi && ESCAPABLE.has(s[p + 1])) {
        if (p > run) parts.push(s.slice(run, p));
        const nc = s[p + 1];
        parts.push(nc === '>' ? '&gt;' : nc);
        INLINE_NEXT.lastIndex = p + 2;
        run = p + 2;
      }
      continue;
    }
    if (c === '`') {
      const j = s.indexOf('`', p + 1);
      if (j > p + 1 && j < hi) {
        if (p > run) parts.push(s.slice(run, p));
        parts.push('<code>' + esc(s.slice(p + 1, j)) + '</code>');
        INLINE_NEXT.lastIndex = j + 1;
        run = j + 1;
      }
      continue;
    }
    if (c === '*') {
      if (s[p + 1] === '*') {
        const j = findStrongClose(s, p + 2, hi);
        if (j > p + 2 && j < hi) {
          if (p > run) parts.push(s.slice(run, p));
          parts.push('<strong>');
          const save = INLINE_NEXT.lastIndex;
          inlineInto(s, env, p + 2, j, parts);
          INLINE_NEXT.lastIndex = save;
          parts.push('</strong>');
          INLINE_NEXT.lastIndex = j + 2;
          run = j + 2;
        } else {
          // A failed ** skips both stars (the reference does i += 2 here).
          INLINE_NEXT.lastIndex = p + 2;
        }
        continue;
      }
      const j = findSingleStar(s, p + 1, hi);
      if (j > p + 1 && j < hi) {
        if (p > run) parts.push(s.slice(run, p));
        parts.push('<em>');
        const save = INLINE_NEXT.lastIndex;
        inlineInto(s, env, p + 1, j, parts);
        INLINE_NEXT.lastIndex = save;
        parts.push('</em>');
        INLINE_NEXT.lastIndex = j + 1;
        run = j + 1;
      }
      continue;
    }
    if (c === '[') {
      const k = findBracketClose(s, p + 1, hi);
      const mm = k !== -1 && k + 1 < hi && s[k + 1] === '(' ? s.indexOf(')', k + 2) : -1;
      const target = mm === -1 || mm >= hi ? '' : s.slice(k + 2, mm);
      if (target !== '' && !hasWS(target)) {
        if (p > run) parts.push(s.slice(run, p));
        parts.push('<a href="' + esc(env.link(target)) + '">');
        const save = INLINE_NEXT.lastIndex;
        inlineInto(s, env, p + 1, k, parts);
        INLINE_NEXT.lastIndex = save;
        parts.push('</a>');
        INLINE_NEXT.lastIndex = mm + 1;
        run = mm + 1;
      }
      continue;
    }
    // An escape-table character: & < > " '
    if (p > run) parts.push(s.slice(run, p));
    parts.push(c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;');
    run = p + 1;
  }
  if (hi > run) parts.push(s.slice(run, hi));
}

/**
 * `lines[from..]` rendered: HTML, table of contents, and the first paragraph's HTML
 * as excerpt. `wc` counts the body's words as it goes: the inline scans count the
 * block texts, and the marker words (heading hashes, list markers, quote marks,
 * fence lines, thematic breaks) and code lines are added here, so no second pass
 * over the body is needed.
 */
function renderMarkdown(lines, from, env, ctx, wc) {
  const ids = new Set();
  const blocks = [];
  const toc = [];
  let excerpt = null;
  let i = from;
  const n = lines.length;
  while (i < n) {
    const line = lines[i];
    if (line.length === 0) {
      i++;
      continue;
    }
    const c0 = line.charCodeAt(0);
    if (c0 === 32 || c0 === 9) {
      if (isBlank(line)) {
        i++;
        continue;
      }
      // An indented line opens a paragraph (indented lines are not code here).
    } else if (c0 === 96) {
      const lang = fenceOpen(line);
      if (lang !== null) {
        wc.n++; // the ```lang line is one word
        const body = [];
        i++;
        while (i < n && !fenceClose(lines[i])) {
          wc.n += countWords(lines[i]);
          body.push(lines[i++]);
        }
        if (i < n) wc.n++; // the closing ``` line is one word
        i++;
        let s = '<pre><code' + (lang === '' ? '' : ' class="language-' + esc(lang) + '"') + '>';
        for (const l of body) {
          s += esc(l);
          s += '\n';
        }
        s += '</code></pre>';
        blocks.push(s);
        continue;
      }
    } else if (c0 === 35) {
      const h = headingOf(line);
      if (h !== null) {
        wc.n++; // the run of #s is one word
        const id = uniqueSlug(slugify(h.text, ctx), ids);
        const html = inline(h.text, env, wc);
        blocks.push(`<h${h.depth} id="${id}">${html}</h${h.depth}>`);
        if (h.depth === 2 || h.depth === 3) toc.push({ level: h.depth, id, html });
        i++;
        continue;
      }
    } else if (c0 === 45 || c0 === 42) {
      if (isHR(line)) {
        wc.n++; // the --- / *** line is one word
        blocks.push('<hr>');
        i++;
        continue;
      }
      const b = bulletOf(line);
      if (b !== null) {
        const items = [[trimLine(b)]];
        wc.n++; // the - / * marker is one word
        i++;
        while (i < n) {
          const l = lines[i];
          const m = bulletOf(l);
          if (m !== null) {
            items.push([trimLine(m)]);
            wc.n++; // another marker
            i++;
            continue;
          }
          if (isContinued(l)) {
            items[items.length - 1].push(trimLine(l));
            i++;
            continue;
          }
          break;
        }
        let s = '<ul>\n';
        for (const it of items) s += `<li>${inline(it.join('\n'), env, wc)}</li>\n`;
        s += '</ul>';
        blocks.push(s);
        continue;
      }
    } else if (c0 === 62) {
      const body = [];
      while (i < n && lines[i].charCodeAt(0) === 62) {
        const l = lines[i++];
        // The '>' is its own word when a space, tab or the end follows it.
        if (l.length === 1 || l.charCodeAt(1) === 32 || l.charCodeAt(1) === 9) wc.n++;
        body.push(l.startsWith('> ') ? l.slice(2) : l.slice(1));
      }
      const kept = [];
      for (const l of body) {
        const t = trimLine(l);
        if (t !== '') kept.push(t);
      }
      if (kept.length === 0) blocks.push('<blockquote>\n</blockquote>');
      else blocks.push(`<blockquote>\n<p>${inline(kept.join('\n'), env, wc)}</p>\n</blockquote>`);
      continue;
    } else if (c0 >= 48 && c0 <= 57) {
      const o = orderedOf(line);
      if (o !== null) {
        const items = [[trimLine(o.text)]];
        const start = o.num;
        wc.n++; // the 12. marker is one word
        i++;
        while (i < n) {
          const l = lines[i];
          const m = orderedOf(l);
          if (m !== null) {
            items.push([trimLine(m.text)]);
            wc.n++; // another marker
            i++;
            continue;
          }
          if (isContinued(l)) {
            items[items.length - 1].push(trimLine(l));
            i++;
            continue;
          }
          break;
        }
        let s = (start !== 1 ? `<ol start="${start}">` : '<ol>') + '\n';
        for (const it of items) s += `<li>${inline(it.join('\n'), env, wc)}</li>\n`;
        s += '</ol>';
        blocks.push(s);
        continue;
      }
    }
    const body = [trimLine(line)];
    i++;
    while (i < n && !endsParagraph(lines[i])) body.push(trimLine(lines[i++]));
    const html = inline(body.join('\n'), env, wc);
    if (excerpt === null) excerpt = html;
    blocks.push(`<p>${html}</p>`);
  }
  return { html: blocks.length === 0 ? '' : blocks.join('\n') + '\n', toc, excerpt: excerpt ?? '' };
}

// ---------------------------------------------------------------- templates

class TemplateError extends Error {}

const PATH = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const FOR = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const IF = /^if (not )?(\S+)$/;
const INCLUDE = /^include "([a-z0-9-]+)"$/;

function pathOf(name, text) {
  if (!PATH.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
  return text.split('.');
}

/** `src`'s tokens: text, {{ }}, {{{ }}} and {% %}, a standalone tag's line taken with it. */
function tokenize(name, src) {
  const tokens = [];
  let text = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === src.length - 1) {
      text += src.slice(i);
      break;
    }
    const next = src[open + 1];
    if (next !== '{' && next !== '%') {
      text += src.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    text += src.slice(i, open);
    if (next === '{') {
      const raw = src[open + 2] === '{';
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError(`template "${name}": a ${raw ? '{{{' : '{{'} is not closed`);
      if (text !== '') tokens.push({ t: 'text', text });
      text = '';
      tokens.push({ t: raw ? 'raw' : 'var', path: pathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError(`template "${name}": a {% is not closed`);
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? src.length : nl;
    const standalone = /^[ \t]*$/.test(src.slice(lineStart, open)) && /^[ \t]*$/.test(src.slice(end, lineEnd));
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? src.length : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}

/** `src` parsed into its tree of nodes (a TemplateError when it does not parse). */
function parseTemplate(name, src) {
  const root = { kind: 'root', body: [] };
  const stack = [root];
  let body = root.body;
  for (const tok of tokenize(name, src)) {
    if (tok.t === 'text') body.push({ kind: 'text', text: tok.text });
    else if (tok.t === 'var' || tok.t === 'raw') body.push({ kind: tok.t, path: tok.path });
    else {
      const tag = tok.tag;
      const top = stack[stack.length - 1];
      let m;
      if ((m = FOR.exec(tag)) !== null) {
        const node = { kind: 'for', name: m[1], path: pathOf(name, m[2]), body: [] };
        body.push(node);
        stack.push(node);
        body = node.body;
      } else if ((m = IF.exec(tag)) !== null) {
        const node = { kind: 'if', not: m[1] !== undefined, path: pathOf(name, m[2]), then: [], else: null };
        body.push(node);
        stack.push(node);
        body = node.then;
      } else if (tag === 'else') {
        if (top.kind !== 'if' || top.else !== null) throw new TemplateError(`template "${name}": an else outside an if`);
        top.else = [];
        body = top.else;
      } else if (tag === 'endfor' || tag === 'endif') {
        if (top.kind !== (tag === 'endfor' ? 'for' : 'if')) throw new TemplateError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`);
        stack.pop();
        const parent = stack[stack.length - 1];
        body = parent.kind === 'root' ? parent.body : parent.kind === 'for' ? parent.body : parent.else ?? parent.then;
      } else if ((m = INCLUDE.exec(tag)) !== null) body.push({ kind: 'include', name: m[1] });
      else throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
    }
  }
  if (stack.length > 1) throw new TemplateError(`template "${name}": a ${stack[stack.length - 1].kind} is not closed`);
  return root.body;
}

/** The value at `path` in the scope chain: its first name from the nearest scope holding it. */
function lookup(scope, path) {
  let s = scope;
  const name = path[0];
  while (s !== null) {
    const v = s.vars[name];
    // A function value can only come from Object.prototype (our scopes never hold
    // functions); the reference's hasOwn check skips those, so fall through here.
    if (v !== undefined && (typeof v !== 'function' || Object.hasOwn(s.vars, name))) {
      let val = v;
      for (let k = 1; k < path.length; k++) {
        if (val === null || typeof val !== 'object' || !Object.hasOwn(val, path[k])) return undefined;
        val = val[path[k]];
      }
      return val;
    }
    if (Object.hasOwn(s.vars, name)) return undefined;
    s = s.parent;
  }
  return undefined;
}

function textOf(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(textOf).join(', ');
  return '';
}

/** `{{ }}` interpolation: textOf then escaped, in one call instead of two. */
function varText(v) {
  if (typeof v === 'string') return esc(v);
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return esc(v.map(textOf).join(', '));
  return '';
}

function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

/**
 * `nodes` rendered into `parts` in `scope`.
 */
function renderNodes(nodes, scope, ctx, depth, parts) {
  for (let ni = 0; ni < nodes.length; ni++) {
    const n = nodes[ni];
    switch (n.kind) {
      case 'text':
        parts.push(n.text);
        break;
      case 'var':
        parts.push(varText(lookup(scope, n.path)));
        break;
      case 'raw':
        parts.push(textOf(lookup(scope, n.path)));
        break;
      case 'if': {
        const v = truthy(lookup(scope, n.path));
        const branch = v !== n.not ? n.then : n.else;
        if (branch !== null) renderNodes(branch, scope, ctx, depth, parts);
        break;
      }
      case 'for': {
        const xs = lookup(scope, n.path);
        if (!Array.isArray(xs)) break;
        const len = xs.length;
        // One scope object per loop execution, mutated per item: the scope is only
        // ever read synchronously while rendering this loop's body, so reusing it
        // (instead of allocating a fresh scope + vars + loop object per item)
        // cannot be observed by any template.
        const sc = { vars: {}, parent: scope };
        const loop = { index: 0, first: true, last: false, length: len };
        sc.vars.loop = loop;
        for (let k = 0; k < len; k++) {
          sc.vars[n.name] = xs[k];
          loop.index = k + 1;
          loop.first = k === 0;
          loop.last = k === len - 1;
          renderNodes(n.body, sc, ctx, depth, parts);
        }
        break;
      }
      case 'include': {
        const t = ctx.templates.get(n.name);
        if (t !== undefined && depth < 8) renderNodes(t, scope, ctx, depth + 1, parts);
        break;
      }
    }
  }
}

// ---------------------------------------------------------------- the build


const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

function resolvePath(dir, rel) {
  const parts = dir === '' ? [] : dir.split('/');
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

/** One site's output tree: path -> text. */
export function run(input) {
  const ctx = {
    templates: new Map(),
    slugCache: new Map(),
    dateCache: new Map(),
  };
  const report = [];
  const names = Object.keys(input.templates).sort(byCodeUnits);
  for (const name of names) {
    try {
      ctx.templates.set(name, parseTemplate(name, input.templates[name]));
    } catch (err) {
      if (!(err instanceof TemplateError)) throw err;
      report.push(err.message);
    }
  }

  const base = input.site.base_url.replace(/\/+$/, '');
  const output = {};
  const broken = new Set();

  // 1. Sources, in code-unit order of their paths; a source that is not .md is static.
  const files = [...input.files].sort((x, y) => byCodeUnits(x.path, y.path));
  const sources = [];
  const statics = [];
  for (const f of files) {
    if (f.path.endsWith('.md')) {
      sources.push({ path: f.path, text: f.content.indexOf('\r') === -1 ? f.content : f.content.replace(/\r\n?/g, '\n') });
    } else statics.push({ path: f.path, content: f.content });
  }

  // 2. Front matter: a refused source is reported and dropped, and so is a draft.
  const kept = [];
  for (const s of sources) {
    const fm = parseFrontMatter(s.text);
    if ('error' in fm) {
      report.push(`refused ${s.path}: ${fm.error}`);
      continue;
    }
    s.data = fm.data;
    s.lines = fm.lines;
    s.from = fm.close + 1;
    s.post = s.path.startsWith('posts/');
    let own;
    for (const d of RESERVED) {
      if (d !== 'posts' && s.path.startsWith(`${d}/`)) { own = d; break; }
    }
    if (own !== undefined) {
      report.push(`refused ${s.path}: ${own}/ is the generator's own`);
      continue;
    }
    if (s.post && !Object.hasOwn(s.data, 'date')) {
      report.push(`refused ${s.path}: a post needs a date`);
      continue;
    }
    const layout = s.data.layout ?? (s.post ? 'post' : 'page');
    if (!ctx.templates.has(layout)) {
      report.push(`refused ${s.path}: layout "${layout}" is no template that parses`);
      continue;
    }
    s.layout = layout;
    if (s.data.draft === true) {
      report.push(`draft ${s.path}`);
      continue;
    }
    kept.push(s);
  }

  // 3. Permalinks: each page's output directory and url, its slug unique in its directory.
  const bySource = new Map();
  const taken = new Map();
  for (const s of kept) {
    const dir = s.post ? 'posts' : dirOf(s.path);
    let set = taken.get(dir);
    if (set === undefined) {
      set = new Set(dir === '' ? RESERVED : []);
      taken.set(dir, set);
    }
    const slug = uniqueSlug(s.data.slug ?? slugify(s.data.title, ctx), set);
    s.slug = slug;
    s.outDir = dir === '' ? slug : `${dir}/${slug}`;
    s.url = `${base}/${s.outDir}/`;
    bySource.set(s.path, s);
  }

  // 4. Markdown, each body's links resolved to the pages and static files they name.
  const staticPaths = new Set(statics.map((f) => f.path));
  for (const s of kept) {
    const dir = dirOf(s.path);
    s.wc = { n: 0, inWord: false };
    const env = {
      link: (target) => {
        if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target) || target.startsWith('/') || target.startsWith('#')) return target;
        const hash = target.indexOf('#');
        const rel = hash === -1 ? target : target.slice(0, hash);
        const frag = hash === -1 ? '' : target.slice(hash);
        const path = rel === '' ? null : resolvePath(dir, rel);
        if (path !== null && bySource.has(path)) return `${bySource.get(path).url}${frag}`;
        if (path !== null && staticPaths.has(path)) return `${base}/${path}${frag}`;
        broken.add(`broken-link ${s.path} -> ${target}`);
        return target;
      },
    };
    const md = renderMarkdown(s.lines, s.from, env, ctx, s.wc);
    s.html = md.html;
    s.toc = md.toc;
    s.excerpt = md.excerpt;
    s.words = s.wc.n;
  }

  // 5. Collections: the posts, newest date first, then by slug; each post's neighbours.
  const posts = kept.filter((s) => s.post);
  posts.sort((x, y) => byCodeUnits(y.data.date, x.data.date) || byCodeUnits(x.slug, y.slug));
  posts.forEach((p, k) => {
    p.newer = k === 0 ? null : posts[k - 1];
    p.older = k === posts.length - 1 ? null : posts[k + 1];
  });

  // 6. Tags, grouped by their slug, each named as first met in the posts' order.
  const bySlug = new Map();
  const ownTags = (s) => {
    const seen = new Set();
    const out = [];
    for (const name of s.data.tags ?? []) {
      const slug = slugify(name, ctx);
      if (!seen.has(slug)) {
        seen.add(slug);
        out.push(name);
      }
    }
    return out;
  };
  for (const p of posts) {
    p.tagRefs = [];
    for (const name of ownTags(p)) {
      const slug = slugify(name, ctx);
      let tag = bySlug.get(slug);
      if (tag === undefined) {
        tag = { name, slug, url: `${base}/tags/${slug}/`, posts: [] };
        bySlug.set(slug, tag);
      }
      tag.posts.push(p);
      p.tagRefs.push(tag);
    }
  }
  for (const s of kept) {
    if (!s.post) {
      s.tagRefs = ownTags(s).map((name) => {
        const slug = slugify(name, ctx);
        return bySlug.get(slug) ?? { name, slug, url: '', posts: [] };
      });
    }
  }
  const tags = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));

  const linkOf = (s) => (s === null ? null : { title: s.data.title, url: s.url, date: s.data.date ?? '', date_long: s.data.date === undefined ? '' : longDate(s.data.date, ctx) });

  // 7. Layouts: every page through its layout, the index pages and the tag pages.
  const cards = new Map();
  for (const p of posts) {
    cards.set(p, {
      title: p.data.title,
      url: p.url,
      date: p.data.date ?? '',
      date_long: p.data.date === undefined ? '' : longDate(p.data.date, ctx),
      summary: p.data.summary ?? '',
      excerpt: p.excerpt,
      reading_minutes: Math.max(1, Math.ceil(p.words / 200)),
      tags: p.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url })),
    });
  }
  const cardOf = (s) => {
    const c = cards.get(s);
    if (c !== undefined) return c;
    return {
      title: s.data.title,
      url: s.url,
      date: s.data.date ?? '',
      date_long: s.data.date === undefined ? '' : longDate(s.data.date, ctx),
      summary: s.data.summary ?? '',
      excerpt: s.excerpt,
      reading_minutes: Math.max(1, Math.ceil(s.words / 200)),
      tags: s.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url })),
    };
  };
  const site = { title: input.site.title, base_url: base };
  const allTags = tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recent = posts.slice(0, input.site.recent).map((p) => cards.get(p));
  const render = (name, vars) => {
    const nodes = ctx.templates.get(name);
    if (nodes === undefined) return null;
    const parts = [];
    renderNodes(nodes, { vars: { site, tags: allTags, recent, ...vars }, parent: null }, ctx, 0, parts);
    return parts.join('');
  };
  for (const s of kept) {
    s.pageObj = {
      ...cardOf(s),
      slug: s.slug,
      content: s.html,
      toc: s.toc.map((h) => ({ level: h.level, id: h.id, html: h.html })),
      newer: linkOf(s.newer ?? null),
      older: linkOf(s.older ?? null),
      is_post: s.post,
    };
  }
  for (const s of kept) {
    output[`${s.outDir}/index.html`] = render(s.layout, { page: s.pageObj });
  }
  const per = input.site.per_page;
  const pages = Math.max(1, Math.ceil(posts.length / per));
  const indexUrl = (k) => (k === 1 ? `${base}/` : `${base}/page/${k}/`);
  for (let k = 1; k <= pages; k++) {
    const html = render('index', {
      posts: posts.slice((k - 1) * per, k * per).map((p) => cards.get(p)),
      pager: { number: k, total: pages, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === pages ? '' : indexUrl(k + 1) },
    });
    if (html !== null) output[k === 1 ? 'index.html' : `page/${k}/index.html`] = html;
  }
  for (const t of tags) {
    const html = render('tag', { tag: { name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => cards.get(p)) } });
    if (html !== null) output[`tags/${t.slug}/index.html`] = html;
  }
  const tagsHtml = render('tags', {});
  if (tagsHtml !== null) output['tags/index.html'] = tagsHtml;
  for (const f of statics) {
    if (Object.hasOwn(output, f.path)) report.push(`shadowed ${f.path}: a built page has its path`);
    else output[f.path] = f.content;
  }

  // 8. The report.
  const lines = [...report, ...broken].sort(byCodeUnits);
  const pageCount = kept.filter((s) => !s.post).length;
  lines.push(`built ${pageCount} pages, ${posts.length} posts, ${tags.length} tags and ${statics.length} static files`);
  output['build-report.txt'] = `${lines.join('\n')}\n`;
  return output;
}

/* No import-time warm-up: the regex-driven code below is fast in the interpreter,
 * so warming the JIT at import cost more than it repaid (measured: removing the
 * x3 warm-up saved ~15 ms of cold process time). Every cache is still created
 * fresh inside run(), so each case is answered alone. */
