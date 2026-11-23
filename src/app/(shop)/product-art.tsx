// Product illustrations drawn for the shop (original artwork, no third-party photos): one per category, in the
// brand's accent colour with the brand name on the part. Shown until the team uploads real photos in the back office.

const ACCENT: Record<string, string> = {
  AMD: '#c81e2a', Intel: '#0a6ab8', ASUS: '#334155', MSI: '#b91c1c', Gigabyte: '#c2410c', ASRock: '#1d4ed8', Zotac: '#a16207',
  Sapphire: '#1e40af', Kingston: '#b91c1c', Corsair: '#ca8a04', 'G.Skill': '#be123c', TeamGroup: '#4338ca', WD: '#111827',
  Crucial: '#1d4ed8', Samsung: '#1e3a8a', 'Cooler Master': '#6d28d9', Seasonic: '#0f766e', 'Lian Li': '#374151', Montech: '#0e7490',
  DeepCool: '#0369a1', Thermalright: '#475569', NZXT: '#7c3aed', 'Fractal Design': '#3f3f46', Arctic: '#0284c7', 'be quiet!': '#c2410c',
  LG: '#a21caf', Dell: '#0369a1', AOC: '#b91c1c', Logitech: '#0f766e', Razer: '#15803d', SteelSeries: '#ea580c', HP: '#0369a1', Lenovo: '#b91c1c',
};
const PALETTE = ['#1d4ed8', '#0f766e', '#7c3aed', '#b45309', '#be123c', '#0369a1'];
export function accentOf(brand: string) {
  if (ACCENT[brand]) return ACCENT[brand];
  let h = 0;
  for (const ch of brand) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

const DARK = '#1f2937', MID = '#374151', LIGHT = '#e5e7eb', METAL = '#cbd5e1';
const fan = (cx: number, cy: number, r: number, c: string) => (
  <g key={`${cx}-${cy}`}>
    <circle cx={cx} cy={cy} r={r} fill={MID} stroke={c} strokeWidth="2" />
    {[0, 72, 144, 216, 288].map(a => <path key={a} d={`M${cx} ${cy} q ${r * .55} ${-r * .2} ${r * .8} ${r * .15}`} fill="none" stroke={METAL} strokeWidth="3" transform={`rotate(${a} ${cx} ${cy})`} />)}
    <circle cx={cx} cy={cy} r={r * .22} fill={c} />
  </g>
);

function Part({ cat, c }: { cat: string; c: string }) {
  switch (cat) {
    case 'cpu': return <g>
      {Array.from({ length: 9 }, (_, k) => <rect key={'t' + k} x={62 + k * 9.5} y="22" width="3" height="10" fill="#b8892b" />)}
      {Array.from({ length: 9 }, (_, k) => <rect key={'b' + k} x={62 + k * 9.5} y="118" width="3" height="10" fill="#b8892b" />)}
      <rect x="52" y="30" width="96" height="90" rx="6" fill="#15803d" />
      <rect x="62" y="38" width="76" height="74" rx="6" fill={METAL} stroke="#94a3b8" strokeWidth="2" />
      <rect x="62" y="38" width="76" height="16" rx="6" fill={c} />
    </g>;
    case 'vga': return <g>
      <rect x="20" y="40" width="160" height="70" rx="8" fill={DARK} />
      <rect x="20" y="40" width="160" height="10" rx="5" fill={c} />
      {fan(70, 78, 24, c)}{fan(130, 78, 24, c)}
      <rect x="180" y="44" width="8" height="62" fill={METAL} />
      <rect x="40" y="110" width="90" height="7" fill="#b8892b" />
    </g>;
    case 'mainboard': return <g>
      <rect x="35" y="15" width="130" height="120" rx="4" fill="#1e293b" />
      <rect x="45" y="25" width="40" height="40" rx="3" fill={METAL} stroke={c} strokeWidth="3" />
      {[0, 1, 2, 3].map(k => <rect key={k} x={100 + k * 9} y="22" width="5" height="50" fill={k % 2 ? MID : c} />)}
      <rect x="45" y="85" width="110" height="7" fill={c} /><rect x="45" y="105" width="110" height="5" fill={MID} />
      <rect x="140" y="78" width="18" height="18" rx="2" fill={MID} />
      <rect x="35" y="15" width="10" height="45" fill={c} opacity=".8" />
    </g>;
    case 'ram': return <g>
      {[0, 1].map(k => <g key={k} transform={`translate(0 ${k * 42})`}>
        <rect x="22" y="38" width="156" height="34" rx="4" fill={DARK} />
        <path d="M22 42 h156 v8 h-156z" fill={c} />
        {Array.from({ length: 16 }, (_, j) => <rect key={j} x={28 + j * 9.4} y="72" width="5" height="6" fill="#b8892b" />)}
      </g>)}
    </g>;
    case 'ssd': return <g>
      <rect x="20" y="58" width="160" height="34" rx="3" fill="#0f172a" />
      <rect x="40" y="63" width="48" height="24" rx="2" fill={MID} /><rect x="96" y="63" width="48" height="24" rx="2" fill={MID} />
      <rect x="20" y="58" width="160" height="7" fill={c} />
      <rect x="172" y="62" width="8" height="26" fill="#b8892b" />
      <circle cx="26" cy="75" r="4" fill={LIGHT} />
    </g>;
    case 'psu': return <g>
      <rect x="40" y="28" width="120" height="96" rx="8" fill={DARK} />
      {fan(100, 76, 36, c)}
      <rect x="40" y="28" width="120" height="10" rx="5" fill={c} />
    </g>;
    case 'case': return <g>
      <rect x="55" y="12" width="90" height="128" rx="6" fill={DARK} />
      <rect x="63" y="20" width="60" height="112" rx="3" fill="#0b1220" stroke={c} strokeWidth="2" />
      {fan(93, 48, 14, c)}{fan(93, 82, 14, c)}{fan(93, 116, 12, c)}
      <rect x="128" y="20" width="10" height="112" rx="2" fill={MID} />
    </g>;
    case 'cooler': return <g>
      {Array.from({ length: 12 }, (_, k) => <rect key={k} x="78" y={22 + k * 8} width="64" height="4" fill={METAL} />)}
      <rect x="70" y="18" width="80" height="100" rx="4" fill="none" stroke="#94a3b8" />
      <rect x="44" y="28" width="30" height="84" rx="4" fill={DARK} />
      {fan(59, 70, 13, c)}
      <rect x="96" y="118" width="28" height="14" fill="#b8892b" />
    </g>;
    case 'monitor': return <g>
      <rect x="20" y="16" width="160" height="96" rx="6" fill={DARK} />
      <rect x="27" y="22" width="146" height="82" rx="3" fill={c} opacity=".85" />
      <path d="M27 104 L120 22 H173 V104Z" fill="#fff" opacity=".12" />
      <rect x="92" y="112" width="16" height="18" fill={MID} /><rect x="66" y="130" width="68" height="6" rx="3" fill={MID} />
    </g>;
    case 'peripheral': return <g>
      <rect x="14" y="62" width="130" height="50" rx="7" fill={DARK} />
      {Array.from({ length: 3 }, (_, r) => Array.from({ length: 10 }, (_, k) => <rect key={`${r}-${k}`} x={21 + k * 12} y={69 + r * 13} width="9" height="9" rx="2" fill={k === 0 && r === 0 ? c : MID} />))}
      <rect x="40" y="99" width="70" height="8" rx="2" fill={MID} />
      <rect x="152" y="58" width="36" height="58" rx="18" fill={DARK} /><line x1="170" y1="62" x2="170" y2="82" stroke={c} strokeWidth="3" />
    </g>;
    case 'cable': return <g>
      <path d="M40 75 C 60 20, 140 130, 160 75" fill="none" stroke={DARK} strokeWidth="7" strokeLinecap="round" />
      <rect x="18" y="64" width="30" height="22" rx="4" fill={c} /><rect x="10" y="68" width="10" height="14" fill={METAL} />
      <rect x="152" y="64" width="30" height="22" rx="4" fill={c} /><rect x="180" y="68" width="10" height="14" fill={METAL} />
    </g>;
    case 'notebook-parts': return <g>
      <rect x="26" y="52" width="148" height="46" rx="8" fill={DARK} />
      <rect x="34" y="60" width="40" height="30" rx="3" fill={c} /><rect x="160" y="66" width="14" height="18" fill="#b8892b" />
    </g>;
    case 'consumable': return <g>
      <rect x="30" y="50" width="140" height="56" rx="10" fill={DARK} />
      <rect x="30" y="50" width="140" height="14" rx="7" fill={c} /><rect x="60" y="106" width="80" height="8" fill={MID} />
    </g>;
    default: return <rect x="50" y="35" width="100" height="80" rx="10" fill={DARK} stroke={c} strokeWidth="4" />;
  }
}

/** Drawn picture of a part: category shape, brand colour, brand name. `label` names it for screen readers. */
export function ProductArt({ cat, brand, label }: { cat: string; brand: string; label: string }) {
  const c = accentOf(brand || 'Generic');
  return (
    <svg viewBox="0 0 200 150" {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })} style={{ width: '78%', height: 'auto', maxHeight: '88%' }}>
      <ellipse cx="100" cy="140" rx="80" ry="6" fill="#000" opacity=".08" />
      <Part cat={cat} c={c} />
      {brand && brand !== 'Generic' && <text x="100" y="148" textAnchor="middle" fontSize="11" fontWeight="700" fill={c} fontFamily="system-ui, sans-serif" letterSpacing=".04em">{brand.toUpperCase()}</text>}
    </svg>
  );
}
