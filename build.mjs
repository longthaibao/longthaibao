// Sinh toàn bộ SVG động cho GitHub profile README.
// GitHub chỉ render SVG qua <img> (không JS, không font ngoài, không ảnh ngoài)
// nên mọi chuyển động dùng SMIL + CSS keyframes, 3D được chiếu sẵn từng frame ở đây.
// Chạy: node build.mjs  → ghi ra ./assets/*.svg
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'assets');

const C = {
  cyan: '#22d3ee', violet: '#a78bfa', pink: '#f472b6', green: '#4ade80',
  amber: '#fbbf24', slate: '#94a3b8', text: '#e2e8f0', dim: '#64748b',
};
const MONO = `'JetBrains Mono','Fira Code','Cascadia Code',Consolas,Menlo,monospace`;
const SANS = `'Inter','SF Pro Display','Segoe UI',system-ui,-apple-system,sans-serif`;
const MONO_CHAR_W = 0.6; // bề rộng 1 ký tự monospace theo em

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r1 = (n) => Math.round(n * 10) / 10;

// PRNG cố định seed để build lại không làm diff SVG nhảy lung tung
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

/* ---------------------------------------------------------------- shared */

const glowFilter = (id, std = 3) => `
  <filter id="${id}" x="-50%" y="-50%" width="200%" height="200%">
    <feGaussianBlur stdDeviation="${std}" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>`;

const skyGradient = (id) => `
  <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#05071a"/>
    <stop offset="0.62" stop-color="#0d0830"/>
    <stop offset="1" stop-color="#02030a"/>
  </linearGradient>`;

function stars({ w, h, count, seed }) {
  const rand = rng(seed);
  let out = '';
  for (let i = 0; i < count; i++) {
    const x = r1(rand() * w), y = r1(rand() * h), r = r1(0.5 + rand() * 1.1);
    const dur = r1(2 + rand() * 4), lo = r1(0.1 + rand() * 0.3);
    out += `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity="${lo}">`
      + `<animate attributeName="opacity" values="${lo};0.9;${lo}" dur="${dur}s" begin="-${r1(rand() * dur)}s" repeatCount="indefinite"/></circle>`;
  }
  return out;
}

// Sàn lưới phối cảnh chạy về phía người xem: mỗi đường ngang đi theo y = hy + f/z với z giảm tuyến tính
function floorGrid({ id, w, h, hy, vx, color, lines = 14, dur = 4, spacing = 80 }) {
  const f = h - hy;
  const S = 24, zFar = 14, zNear = 0.9;
  const ys = [];
  for (let s = 0; s <= S; s++) ys.push(r1(hy + f / (zFar + (zNear - zFar) * (s / S))));
  const values = ys.join(';');

  let horiz = '';
  for (let i = 0; i < lines; i++) {
    const begin = `-${r1((i * dur) / lines)}s`;
    horiz += `<line x1="0" x2="${w}" y1="${hy}" y2="${hy}">`
      + `<animate attributeName="y1" values="${values}" dur="${dur}s" begin="${begin}" repeatCount="indefinite"/>`
      + `<animate attributeName="y2" values="${values}" dur="${dur}s" begin="${begin}" repeatCount="indefinite"/></line>`;
  }
  let vert = '';
  const K = Math.ceil(w / spacing);
  for (let k = -K; k <= K; k++) vert += `<line x1="${vx}" y1="${hy}" x2="${vx + k * spacing * 2}" y2="${hy + f * 2}"/>`;

  return {
    defs: `
  <linearGradient id="${id}-fade" gradientUnits="userSpaceOnUse" x1="0" y1="${hy}" x2="0" y2="${h}">
    <stop offset="0" stop-color="#000"/><stop offset="0.45" stop-color="#fff" stop-opacity="0.9"/><stop offset="1" stop-color="#fff"/>
  </linearGradient>
  <mask id="${id}-mask"><rect x="0" y="${hy}" width="${w}" height="${f}" fill="url(#${id}-fade)"/></mask>
  <radialGradient id="${id}-horizon" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="${C.violet}" stop-opacity="0.55"/>
    <stop offset="0.5" stop-color="${C.cyan}" stop-opacity="0.12"/>
    <stop offset="1" stop-color="${C.cyan}" stop-opacity="0"/>
  </radialGradient>`,
    body: `
  <ellipse cx="${vx}" cy="${hy}" rx="${w * 0.55}" ry="46" fill="url(#${id}-horizon)"/>
  <g mask="url(#${id}-mask)" stroke="${color}" stroke-width="1" opacity="0.55">${horiz}${vert}</g>
  <line x1="0" x2="${w}" y1="${hy}" y2="${hy}" stroke="${C.cyan}" stroke-opacity="0.7" stroke-width="1.2" filter="url(#glow)"/>`,
  };
}

/* ---------------------------------------------------------------- 3D wireframe */

const PHI = (1 + Math.sqrt(5)) / 2;
const ICO_V = [
  [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
  [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
  [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
].map((v) => v.map((c) => c / Math.hypot(1, PHI)));
const OCT_V = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

// Cạnh = các cặp đỉnh có khoảng cách ngắn nhất (đúng cho khối đa diện đều)
function edgesOf(verts) {
  const d2 = (a, b) => a.reduce((s, _, i) => s + (a[i] - b[i]) ** 2, 0);
  let min = Infinity;
  for (let i = 0; i < verts.length; i++) for (let j = i + 1; j < verts.length; j++) min = Math.min(min, d2(verts[i], verts[j]));
  const edges = [];
  for (let i = 0; i < verts.length; i++) for (let j = i + 1; j < verts.length; j++) {
    if (Math.abs(d2(verts[i], verts[j]) - min) < 1e-6) edges.push([i, j]);
  }
  return edges;
}

function rotate([x, y, z], ax, ay, az) {
  let t;
  t = y * Math.cos(ax) - z * Math.sin(ax); z = y * Math.sin(ax) + z * Math.cos(ax); y = t;
  t = x * Math.cos(ay) + z * Math.sin(ay); z = -x * Math.sin(ay) + z * Math.cos(ay); x = t;
  t = x * Math.cos(az) - y * Math.sin(az); y = x * Math.sin(az) + y * Math.cos(az); x = t;
  return [x, y, z];
}

// Chiếu sẵn F frame → animate thuộc tính "d" của 1 path; frame cuối = frame đầu nên lặp liền mạch
function wireframe({ verts, cx, cy, size, frames = 72, dur, dir = 1, color, width, dots }) {
  const edges = edgesOf(verts);
  const persp = 3.2;
  const paths = [], vx = verts.map(() => []), vy = verts.map(() => []);
  for (let f = 0; f <= frames; f++) {
    const t = (f / frames) * Math.PI * 2;
    const p = verts.map((v) => {
      const [x, y, z] = rotate(v, 0.45 + 0.22 * Math.sin(t), dir * t, 0.18 * Math.cos(t));
      const k = persp / (persp + z);
      return [r1(cx + x * size * k), r1(cy + y * size * k)];
    });
    paths.push(edges.map(([a, b]) => `M${p[a][0]} ${p[a][1]}L${p[b][0]} ${p[b][1]}`).join(''));
    p.forEach(([x, y], i) => { vx[i].push(x); vy[i].push(y); });
  }
  let out = `<path d="${paths[0]}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" filter="url(#glow)">`
    + `<animate attributeName="d" values="${paths.join(';')}" dur="${dur}s" repeatCount="indefinite"/></path>`;
  if (dots) {
    verts.forEach((_, i) => {
      out += `<circle r="2.6" fill="#fff" cx="${vx[i][0]}" cy="${vy[i][0]}" filter="url(#glow)">`
        + `<animate attributeName="cx" values="${vx[i].join(';')}" dur="${dur}s" repeatCount="indefinite"/>`
        + `<animate attributeName="cy" values="${vy[i].join(';')}" dur="${dur}s" repeatCount="indefinite"/></circle>`;
    });
  }
  return out;
}

/* ---------------------------------------------------------------- hero */

function hero() {
  const W = 1200, H = 460, HY = 318;
  const floor = floorGrid({ id: 'hf', w: W, h: H, hy: HY, vx: 600, color: C.cyan });
  const ox = 920, oy = 190;
  const orbit = `M${ox - 190} ${oy} a190 44 0 1 0 380 0 a190 44 0 1 0 -380 0`;

  const chips = ['VIETNAM', 'HCMUT ALUMNI', 'GAMING TECH'];
  let chipX = 80, chipSvg = '';
  for (const label of chips) {
    const cw = label.length * 12 * MONO_CHAR_W + label.length * 2 + 26;
    chipSvg += `<g transform="translate(${r1(chipX)} 262)">`
      + `<rect width="${r1(cw)}" height="28" rx="14" fill="${C.cyan}" fill-opacity="0.07" stroke="${C.cyan}" stroke-opacity="0.45"/>`
      + `<circle cx="14" cy="14" r="3" fill="${C.green}"><animate attributeName="opacity" values="1;0.3;1" dur="2s" repeatCount="indefinite"/></circle>`
      + `<text x="24" y="18.5" font-family="${MONO}" font-size="12" letter-spacing="2" fill="${C.text}">${esc(label)}</text></g>`;
    chipX += cw + 10;
  }

  const roles = ['Software Developer', 'Realtime Display Systems', 'Gymer  ·  Footballer  ·  Manucian'];
  const roleSvg = roles.map((r, i) => `<text class="role r${i}" x="80" y="232" font-family="${MONO}" font-size="20" fill="${C.text}">`
    + `<tspan fill="${C.cyan}">&gt;_ </tspan>${esc(r)}</text>`).join('');

  const corner = (x, y, sx, sy) => `<path d="M${x} ${y + sy * 22}V${y}H${x + sx * 22}" fill="none" stroke="${C.cyan}" stroke-width="2" stroke-opacity="0.7"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Thái Bảo Long — Software Developer">
<style>
  .role{opacity:0;animation:role 9s infinite}
  .r1{animation-delay:3s}.r2{animation-delay:6s}
  @keyframes role{0%{opacity:0;transform:translateY(10px)}5%,29%{opacity:1;transform:translateY(0)}34%,100%{opacity:0;transform:translateY(-10px)}}
  .gl{opacity:0;animation:gl 5s infinite steps(1)}
  .gl2{animation-delay:.12s}
  @keyframes gl{0%,84%,100%{opacity:0;transform:translate(0,0)}85%{opacity:.85;transform:translate(-5px,2px)}87%{opacity:.85;transform:translate(4px,-2px)}89%{opacity:.6;transform:translate(-2px,0)}91%{opacity:0}}
  .blink{animation:blink 1.2s infinite steps(1)}
  @keyframes blink{50%{opacity:0}}
</style>
<defs>
  ${skyGradient('sky')}
  ${glowFilter('glow', 3)}
  ${glowFilter('glowBig', 10)}
  ${floor.defs}
  <linearGradient id="name" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="${C.cyan}"><animate attributeName="stop-color" values="${C.cyan};${C.violet};${C.pink};${C.cyan}" dur="6s" repeatCount="indefinite"/></stop>
    <stop offset="0.5" stop-color="${C.violet}"><animate attributeName="stop-color" values="${C.violet};${C.pink};${C.cyan};${C.violet}" dur="6s" repeatCount="indefinite"/></stop>
    <stop offset="1" stop-color="${C.pink}"><animate attributeName="stop-color" values="${C.pink};${C.cyan};${C.violet};${C.pink}" dur="6s" repeatCount="indefinite"/></stop>
  </linearGradient>
  <radialGradient id="core" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="${C.violet}" stop-opacity="0.45"/><stop offset="1" stop-color="${C.violet}" stop-opacity="0"/>
  </radialGradient>
  <clipPath id="frame"><rect width="${W}" height="${H}" rx="18"/></clipPath>
</defs>
<g clip-path="url(#frame)">
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  ${stars({ w: W, h: HY - 10, count: 80, seed: 27 })}
  ${floor.body}

  <!-- vật thể 3D: icosahedron + octahedron quay ngược chiều + quỹ đạo -->
  <circle cx="${ox}" cy="${oy}" r="150" fill="url(#core)">
    <animate attributeName="r" values="140;165;140" dur="5s" repeatCount="indefinite"/>
  </circle>
  <ellipse cx="${ox}" cy="${HY + 34}" rx="130" ry="12" fill="${C.violet}" opacity="0.25" filter="url(#glowBig)">
    <animate attributeName="rx" values="110;140;110" dur="5s" repeatCount="indefinite"/>
  </ellipse>
  <path d="${orbit}" fill="none" stroke="${C.violet}" stroke-opacity="0.35" stroke-dasharray="4 8" transform="rotate(-14 ${ox} ${oy})"/>
  ${wireframe({ verts: ICO_V, cx: ox, cy: oy, size: 118, dur: 16, color: C.cyan, width: 1.6, dots: true })}
  ${wireframe({ verts: OCT_V, cx: ox, cy: oy, size: 48, dur: 9, dir: -1, color: C.pink, width: 1.4 })}
  <g transform="rotate(-14 ${ox} ${oy})">
    <circle r="5" fill="${C.amber}" filter="url(#glow)"><animateMotion path="${orbit}" dur="7s" repeatCount="indefinite"/></circle>
  </g>

  <!-- text -->
  <text x="80" y="108" font-family="${MONO}" font-size="15" fill="${C.cyan}" opacity="0.85">~/hello-world $ ./intro.sh<tspan class="blink" fill="${C.cyan}"> █</tspan></text>
  <g font-family="${SANS}" font-size="68" font-weight="800" letter-spacing="-1">
    <text class="gl" x="80" y="185" fill="${C.cyan}">Thái Bảo Long</text>
    <text class="gl gl2" x="80" y="185" fill="${C.pink}">Thái Bảo Long</text>
    <text x="80" y="185" fill="url(#name)">Thái Bảo Long</text>
  </g>
  ${roleSvg}
  ${chipSvg}

  <!-- HUD -->
  ${corner(18, 18, 1, 1)}${corner(W - 18, 18, -1, 1)}${corner(18, H - 18, 1, -1)}${corner(W - 18, H - 18, -1, -1)}
  <text x="${W - 40}" y="44" text-anchor="end" font-family="${MONO}" font-size="11" letter-spacing="2" fill="${C.slate}">SYS.ONLINE <tspan class="blink" fill="${C.green}">●</tspan></text>
  <text x="40" y="${H - 34}" font-family="${MONO}" font-size="11" letter-spacing="2" fill="${C.dim}">LAT 10.7769 · LON 106.7009</text>
  <text x="${W - 40}" y="${H - 34}" text-anchor="end" font-family="${MONO}" font-size="11" letter-spacing="2" fill="${C.dim}">BUILD PASSING · v${new Date().getFullYear()}</text>
  <rect width="${W}" height="2" fill="${C.cyan}" opacity="0.08">
    <animate attributeName="y" values="0;${H}" dur="6s" repeatCount="indefinite"/>
  </rect>
</g>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="18" fill="none" stroke="${C.cyan}" stroke-opacity="0.25"/>
</svg>`;
}

/* ---------------------------------------------------------------- terminal */

const tk = (text, color = C.slate) => [text, color];
const str = (s) => tk(`"${s}"`, C.green);
const arr = (items) => [tk('['), ...items.flatMap((s, i) => (i ? [tk(', '), str(s)] : [str(s)])), tk(']')];
const kv = (key, value, last = false) => [
  tk('  "'), tk(key, C.violet), tk('": '), ...(Array.isArray(value[0]) ? value : [value]), ...(last ? [] : [tk(',')]),
];

const TERM_LINES = [
  { cmd: 'whoami' },
  { out: [tk('Thái Bảo Long', C.text), tk('  ·  software developer  ·  HCMUT alumni', C.slate)] },
  { cmd: 'cat ~/profile.json' },
  { out: [tk('{')] },
  { out: kv('location', str('Ho Chi Minh City, Vietnam')) },
  { out: kv('work', str('software developer · gaming & entertainment')) },
  { out: kv('education', str('HCMUT · Bach Khoa University (graduated)')) },
  { out: kv('focus', arr(['realtime displays', 'LED signage', 'desktop apps'])) },
  { out: kv('stack', arr(['TypeScript', 'React', 'NestJS', 'Electron', 'C#', 'PostgreSQL'])) },
  { out: kv('offline', arr(['gym', 'football', 'Man United'])) },
  { out: kv('status', tk('"shipping to production"', C.amber), true) },
  { out: [tk('}')] },
  { cmd: 'echo $MOTTO' },
  { out: [tk('Build it. Ship it. Make it better.', C.cyan)] },
  { prompt: true },
];

function terminal() {
  const W = 900, FS = 15, LH = 25, TOP = 78, PAD = 28;
  const CW = FS * MONO_CHAR_W;
  const H = TOP + TERM_LINES.length * LH + 22;
  const promptTokens = [tk('long', C.green), tk('@'), tk('dev', C.green), tk(':'), tk('~', C.cyan), tk('$ ', C.text)];
  const promptLen = promptTokens.reduce((n, [s]) => n + s.length, 0);
  const tspans = (tokens) => tokens.map(([s, c]) => `<tspan fill="${c}">${esc(s)}</tspan>`).join('');
  const appear = (t) => `<animate attributeName="opacity" from="0" to="1" begin="${r1(t)}s" dur="0.15s" fill="freeze"/>`;

  let t = 0.5, body = '', clips = '';
  TERM_LINES.forEach((line, i) => {
    const y = TOP + i * LH;
    if (line.cmd !== undefined || line.prompt) {
      body += `<text x="${PAD}" y="${y}" opacity="0">${tspans(promptTokens)}${appear(t)}</text>`;
      t += 0.25;
      if (line.prompt) {
        body += `<rect x="${r1(PAD + promptLen * CW)}" y="${y - FS + 2}" width="${r1(CW)}" height="${FS + 2}" fill="${C.cyan}" opacity="0">`
          + `${appear(t)}<animate attributeName="fill-opacity" values="1;0;1" dur="1s" begin="${r1(t)}s" repeatCount="indefinite" calcMode="discrete"/></rect>`;
        return;
      }
      // Gõ phím: mở rộng clipPath theo số ký tự
      const x0 = PAD + promptLen * CW, typeDur = Math.max(0.3, line.cmd.length * 0.06);
      clips += `<clipPath id="c${i}"><rect x="${r1(x0)}" y="${y - FS - 2}" width="0" height="${FS + 8}">`
        + `<animate attributeName="width" from="0" to="${r1(line.cmd.length * CW + 4)}" begin="${r1(t)}s" dur="${r1(typeDur)}s" fill="freeze"/></rect></clipPath>`;
      body += `<text x="${r1(x0)}" y="${y}" fill="${C.text}" clip-path="url(#c${i})">${esc(line.cmd)}</text>`;
      t += typeDur + 0.35;
    } else {
      body += `<text x="${PAD}" y="${y}" opacity="0">${tspans(line.out)}${appear(t)}</text>`;
      t += 0.12;
    }
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Terminal: about Thái Bảo Long">
<defs>
  <linearGradient id="border" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${C.cyan}"/><stop offset="0.5" stop-color="${C.violet}"/><stop offset="1" stop-color="${C.pink}"/>
  </linearGradient>
  <pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="${C.cyan}" fill-opacity="0.07"/></pattern>
  ${clips}
</defs>
<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="14" fill="#0a0e1f"/>
<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="14" fill="url(#dots)"/>
<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="14" fill="none" stroke="url(#border)" stroke-opacity="0.6" stroke-width="1.5"/>
<path d="M1 42H${W - 1}" stroke="${C.cyan}" stroke-opacity="0.12"/>
<circle cx="24" cy="21.5" r="6" fill="#ff5f57"/><circle cx="44" cy="21.5" r="6" fill="#febc2e"/><circle cx="64" cy="21.5" r="6" fill="#28c840"/>
<text x="${W / 2}" y="26" text-anchor="middle" font-family="${MONO}" font-size="12" fill="${C.dim}">long@dev: ~ — zsh</text>
<g font-family="${MONO}" font-size="${FS}" xml:space="preserve">${body}</g>
</svg>`;
}

/* ---------------------------------------------------------------- divider + footer */

function divider() {
  const W = 1200, H = 28, Y = 14;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<defs>
  <linearGradient id="ln" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="${C.cyan}" stop-opacity="0"/><stop offset="0.3" stop-color="${C.cyan}" stop-opacity="0.5"/>
    <stop offset="0.7" stop-color="${C.violet}" stop-opacity="0.5"/><stop offset="1" stop-color="${C.violet}" stop-opacity="0"/>
  </linearGradient>
  <linearGradient id="spark" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
  </linearGradient>
  ${glowFilter('glow', 2)}
</defs>
<rect x="0" y="${Y - 0.5}" width="${W}" height="1" fill="url(#ln)"/>
<rect x="-200" y="${Y - 1}" width="200" height="2" fill="url(#spark)" filter="url(#glow)">
  <animate attributeName="x" values="-200;${W}" dur="3.6s" repeatCount="indefinite"/>
</rect>
<rect x="${W / 2 - 6}" y="${Y - 6}" width="12" height="12" fill="#0a0e1f" stroke="${C.cyan}" transform="rotate(45 ${W / 2} ${Y})" filter="url(#glow)">
  <animateTransform attributeName="transform" type="rotate" values="45 ${W / 2} ${Y};405 ${W / 2} ${Y}" dur="8s" repeatCount="indefinite"/>
</rect>
<circle cx="${W / 2 - 28}" cy="${Y}" r="2" fill="${C.cyan}"/><circle cx="${W / 2 + 28}" cy="${Y}" r="2" fill="${C.violet}"/>
</svg>`;
}

function footer() {
  const W = 1200, H = 230, HY = 140;
  const floor = floorGrid({ id: 'ff', w: W, h: H, hy: HY, vx: 600, color: C.violet, lines: 10, dur: 3 });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Thanks for visiting">
<defs>
  ${skyGradient('sky')}
  ${glowFilter('glow', 3)}
  ${floor.defs}
  <linearGradient id="txt" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="${C.cyan}"/><stop offset="0.5" stop-color="${C.violet}"/><stop offset="1" stop-color="${C.pink}"/>
  </linearGradient>
  <clipPath id="frame"><rect width="${W}" height="${H}" rx="18"/></clipPath>
</defs>
<g clip-path="url(#frame)">
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  ${stars({ w: W, h: HY - 10, count: 40, seed: 10 })}
  ${floor.body}
  <text x="${W / 2}" y="72" text-anchor="middle" font-family="${SANS}" font-size="40" font-weight="800" letter-spacing="10" fill="url(#txt)" filter="url(#glow)">THANKS FOR VISITING</text>
  <text x="${W / 2}" y="108" text-anchor="middle" font-family="${MONO}" font-size="14" letter-spacing="3" fill="${C.slate}">see you in the next commit  ·  Manucian forever</text>
</g>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="18" fill="none" stroke="${C.violet}" stroke-opacity="0.25"/>
</svg>`;
}

/* ---------------------------------------------------------------- contribution city */

const GH_USER = process.env.GH_USER || 'longthaibao';
const DAY_MS = 86_400_000;

// Lấy đúng dữ liệu lịch contribution mà profile công khai đang hiển thị (gồm private nếu user bật),
// không cần token. Parse chặt + kiểm tra số ngày để markup GitHub đổi thì fail rõ ràng thay vì vẽ sai.
async function fetchContributions() {
  const res = await fetch(`https://github.com/users/${encodeURIComponent(GH_USER)}/contributions`, {
    headers: { 'User-Agent': 'profile-readme-build' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`GitHub trả HTTP ${res.status}`);
  const html = await res.text();

  const counts = new Map();
  for (const m of html.matchAll(/<tool-tip\b[^>]*\bfor="([^"]+)"[^>]*>([^<]*)<\/tool-tip>/g)) {
    const n = /^(\d[\d,]*) contributions?\b/.exec(m[2].trim());
    counts.set(m[1], n ? Number(n[1].replace(/,/g, '')) : 0);
  }
  const days = [];
  for (const m of html.matchAll(/<td\b[^>]*\bdata-date="(\d{4}-\d{2}-\d{2})"[^>]*>/g)) {
    const id = /\bid="([^"]+)"/.exec(m[0])?.[1];
    days.push({ date: m[1], count: counts.get(id) ?? 0 });
  }
  if (days.length < 300) throw new Error(`parse lịch thất bại: chỉ đọc được ${days.length} ngày`);
  return days.sort((a, b) => (a.date < b.date ? -1 : 1));
}

// Dữ liệu giả để xem trước giao diện (CONTRIB_DEMO=1), không bao giờ dùng cho bản push
function demoContributions() {
  const rand = rng(2710);
  const end = Date.UTC(2026, 10, 13);
  return Array.from({ length: 371 }, (_, i) => {
    const d = new Date(end - (370 - i) * DAY_MS);
    const weekend = d.getUTCDay() % 6 === 0;
    const burst = Math.sin(i / 23) > 0.4 ? 2.2 : 1;
    const count = rand() < (weekend ? 0.45 : 0.12) ? 0 : Math.round(rand() ** 2 * 9 * burst);
    return { date: d.toISOString().slice(0, 10), count };
  });
}

function contribStats(days) {
  let total = 0, longest = 0, run = 0, peak = days[0], active = 0;
  for (const d of days) {
    total += d.count;
    if (d.count > 0) { active++; run++; longest = Math.max(longest, run); } else run = 0;
    if (d.count > peak.count) peak = d;
  }
  // Streak hiện tại: hôm nay chưa commit thì vẫn tính từ hôm qua
  let current = 0;
  let i = days.length - 1;
  if (days[i].count === 0) i--;
  while (i >= 0 && days[i].count > 0) { current++; i--; }
  return { total, longest, current, peak, active };
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const target = amt > 0 ? 255 : 0, k = Math.abs(amt);
  const ch = (v) => Math.round(v + (target - v) * k).toString(16).padStart(2, '0');
  return `#${ch(n >> 16)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}

const LEVEL_COLORS = ['#1b2440', '#0e7490', C.cyan, C.violet, C.pink];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function contribCity(days) {
  const W = 1200, H = 500, FRONT = 446;
  const CELL = 19, BW = 13, PDX = 6, PDY = 8, RDX = 8, RDY = 11, MAXH = 112;
  const st = contribStats(days);
  const max = Math.max(1, st.peak.count);
  const firstWd = new Date(`${days[0].date}T00:00:00Z`).getUTCDay();
  const weeks = Math.floor((days.length - 1 + firstWd) / 7) + 1;
  const x0 = Math.round((W - (weeks * CELL + 6 * RDX + PDX)) / 2);

  // Chủ nhật ở hàng xa nhất (giống lịch GitHub: CN nằm trên cùng)
  const place = (i) => {
    const wd = (i + firstWd) % 7, week = Math.floor((i + firstWd) / 7), back = 6 - wd;
    return { x: x0 + week * CELL + back * RDX, base: FRONT - back * RDY, week, back };
  };
  const levelOf = (c) => (c === 0 ? 0 : Math.min(4, 1 + Math.floor(Math.sqrt(c / max) * 3.999)));

  const order = days.map((d, i) => ({ ...d, ...place(i) }))
    .sort((a, b) => b.back - a.back || a.week - b.week); // vẽ xa → gần, trái → phải (painter's algorithm)

  let bars = '', peakPos = null;
  for (const d of order) {
    const lv = levelOf(d.count), col = LEVEL_COLORS[lv];
    const h = d.count === 0 ? 2 : 8 + Math.sqrt(d.count / max) * MAXH;
    const { x, base } = d, top = base - h;
    const front = `${x},${r1(top)} ${x + BW},${r1(top)} ${x + BW},${base} ${x},${base}`;
    const side = `${x + BW},${r1(top)} ${x + BW + PDX},${r1(top - PDY)} ${x + BW + PDX},${base - PDY} ${x + BW},${base}`;
    const lid = `${x},${r1(top)} ${x + BW},${r1(top)} ${x + BW + PDX},${r1(top - PDY)} ${x + PDX},${r1(top - PDY)}`;
    const delay = r1(0.3 + d.week * 0.028 + d.back * 0.05);
    const op = lv === 0 ? ' opacity="0.55"' : '';
    bars += `<g class="b" style="transform-origin:${x}px ${base}px;animation-delay:${delay}s"${op}>`
      + `<polygon points="${front}" fill="${col}"/><polygon points="${side}" fill="${shade(col, -0.45)}"/>`
      + `<polygon points="${lid}" fill="${shade(col, 0.35)}"/></g>`;
    if (d.date === st.peak.date) peakPos = { x: x + (BW + PDX) / 2, y: top - PDY };
  }

  // Mặt sàn + lưới tuần
  const fl = { x: x0 - 12, y: FRONT + 6 }, fr = { x: x0 + weeks * CELL + 6, y: FRONT + 6 };
  const bd = { x: 6 * RDX + PDX + 8, y: -(6 * RDY + PDY + 8) };
  let grid = '';
  for (let w = 0; w <= weeks; w += 1) {
    const gx = x0 - 3 + w * CELL;
    grid += `<line x1="${gx}" y1="${FRONT + 6}" x2="${gx + bd.x}" y2="${FRONT + 6 + bd.y}"/>`;
  }
  for (let r = 0; r <= 7; r++) {
    const t = r / 7;
    grid += `<line x1="${r1(fl.x + bd.x * t)}" y1="${r1(fl.y + bd.y * t)}" x2="${r1(fr.x + bd.x * t)}" y2="${r1(fr.y + bd.y * t)}"/>`;
  }

  let months = '', lastMonth = -1;
  days.forEach((d, i) => {
    const m = Number(d.date.slice(5, 7)) - 1;
    if (m !== lastMonth && Number(d.date.slice(8)) <= 7) {
      const { week } = place(i);
      months += `<text x="${x0 + week * CELL}" y="${FRONT + 28}">${MONTHS[m].toUpperCase()}</text>`;
    }
    lastMonth = m;
  });

  const fmtDate = (s) => `${MONTHS[Number(s.slice(5, 7)) - 1]} ${s.slice(8)}`;
  const statBlocks = [
    ['TOTAL', st.total.toLocaleString('en-US'), C.cyan],
    ['ACTIVE DAYS', st.active, C.text],
    ['LONGEST STREAK', `${st.longest}d`, C.violet],
    ['CURRENT STREAK', `${st.current}d`, C.pink],
  ].map(([label, val, col], i) => {
    const x = W - 48 - (3 - i) * 150;
    return `<text x="${x}" y="70" text-anchor="end" font-family="${SANS}" font-size="28" font-weight="800" fill="${col}">${esc(val)}</text>`
      + `<text x="${x}" y="92" text-anchor="end" font-family="${MONO}" font-size="10" letter-spacing="2" fill="${C.dim}">${label}</text>`;
  }).join('');

  const beacon = peakPos && st.peak.count > 0 ? `
  <g class="fadein" style="animation-delay:2.6s">
    <line x1="${r1(peakPos.x)}" y1="${r1(peakPos.y)}" x2="${r1(peakPos.x)}" y2="${r1(peakPos.y - 46)}" stroke="${C.pink}" stroke-dasharray="3 3"/>
    <circle cx="${r1(peakPos.x)}" cy="${r1(peakPos.y)}" r="4" fill="${C.pink}" filter="url(#glow)">
      <animate attributeName="r" values="3;7;3" dur="1.6s" repeatCount="indefinite"/>
    </circle>
    <text x="${r1(peakPos.x)}" y="${r1(peakPos.y - 54)}" text-anchor="middle" font-family="${MONO}" font-size="11" letter-spacing="1.5" fill="${C.pink}">PEAK · ${st.peak.count} · ${fmtDate(st.peak.date).toUpperCase()}</text>
  </g>` : '';

  const empty = st.total === 0
    ? `<text x="${W / 2}" y="330" text-anchor="middle" font-family="${MONO}" font-size="14" letter-spacing="4" fill="${C.slate}">NO PUBLIC ACTIVITY YET</text>` : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${st.total} contributions in the last year">
<style>
  .b{animation:rise 1.1s cubic-bezier(.2,.9,.25,1) both}
  @keyframes rise{from{transform:scaleY(0)}}
  .fadein{animation:fadein .8s ease-out both}
  @keyframes fadein{from{opacity:0}}
</style>
<defs>
  ${skyGradient('sky')}
  ${glowFilter('glow', 3)}
  <radialGradient id="hz" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="${C.violet}" stop-opacity="0.4"/><stop offset="1" stop-color="${C.cyan}" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="beam" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="${C.cyan}" stop-opacity="0"/><stop offset="0.5" stop-color="${C.cyan}" stop-opacity="0.22"/><stop offset="1" stop-color="${C.cyan}" stop-opacity="0"/>
  </linearGradient>
  <linearGradient id="title" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="${C.cyan}"/><stop offset="0.6" stop-color="${C.violet}"/><stop offset="1" stop-color="${C.pink}"/>
  </linearGradient>
  <clipPath id="frame"><rect width="${W}" height="${H}" rx="18"/></clipPath>
</defs>
<g clip-path="url(#frame)">
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  ${stars({ w: W, h: 300, count: 50, seed: 53 })}
  <ellipse cx="${W / 2}" cy="${FRONT - 60}" rx="${W * 0.55}" ry="90" fill="url(#hz)"/>

  <text x="48" y="64" font-family="${SANS}" font-size="26" font-weight="800" letter-spacing="3" fill="url(#title)">CONTRIBUTION CITY</text>
  <text x="48" y="90" font-family="${MONO}" font-size="12" letter-spacing="1.5" fill="${C.dim}">// last 365 days · github.com/${esc(GH_USER)} · peak ${st.peak.count}</text>
  ${statBlocks}

  <polygon points="${fl.x},${fl.y} ${fr.x},${fr.y} ${fr.x + bd.x},${fr.y + bd.y} ${fl.x + bd.x},${fl.y + bd.y}" fill="${C.cyan}" fill-opacity="0.04" stroke="${C.cyan}" stroke-opacity="0.35"/>
  <g stroke="${C.cyan}" stroke-opacity="0.08">${grid}</g>
  <g>${bars}</g>
  <g font-family="${MONO}" font-size="10" letter-spacing="1.5" fill="${C.dim}">${months}</g>
  ${beacon}
  ${empty}

  <rect x="-120" y="120" width="120" height="${FRONT - 100}" fill="url(#beam)">
    <animate attributeName="x" values="-120;${W}" dur="5s" begin="3s" repeatCount="indefinite"/>
  </rect>
</g>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="18" fill="none" stroke="${C.cyan}" stroke-opacity="0.25"/>
</svg>`;
}

/* ---------------------------------------------------------------- main */

async function main() {
  mkdirSync(OUT, { recursive: true });
  const files = { 'hero.svg': hero(), 'terminal.svg': terminal(), 'divider.svg': divider(), 'footer.svg': footer() };

  try {
    const days = process.env.CONTRIB_DEMO ? demoContributions() : await fetchContributions();
    files['contrib.svg'] = contribCity(days);
  } catch (err) {
    // Giữ nguyên contrib.svg cũ thay vì ghi đè bằng thành phố trống
    console.error(`✗ contrib.svg: ${err.message}`);
    process.exitCode = 1;
  }

  for (const [name, svg] of Object.entries(files)) {
    writeFileSync(join(OUT, name), svg, 'utf8');
    console.log(`✓ assets/${name}  ${(Buffer.byteLength(svg) / 1024).toFixed(1)} KB`);
  }
}

main().catch((err) => {
  console.error('Build SVG thất bại:', err.message);
  process.exitCode = 1;
});
