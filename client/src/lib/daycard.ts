// The day's card: a picture of a finished day (4:5, 1080×1350) to keep or share. The day's blocks as the planner's
// column on the left, the numbers on the right, the shutdown at the foot. Drawn on a canvas in the planner's own look
// (paper ground, ink, the one blue for the tick), in Jost.
import { MARK } from './mark';

export interface CardData {
  title: string; // "Thursday, 22 October"
  brand: string;
  blocks: { start: number; end: number; label: string; kind: string }[];
  stats: { label: string; value: string }[];
  habits: { name: string; done: boolean }[];
  shutdown: string; // "Shutdown complete · 18:42"
  clock: (m: number) => string;
}

const W = 1080, H = 1350;
const C = { paper: '#f8f8f8', card: '#ffffff', ink: '#0a0a0a', muted: '#6b6b6b', faint: '#d4d4d4', soft: '#ececec', hue: '#1d5fbf' };
const FONT = '"Jost", "Futura", "Century Gothic", system-ui, sans-serif';

export async function drawDayCard(canvas: HTMLCanvasElement, d: CardData) {
  try { await Promise.all(['400 30px Jost', '500 30px Jost'].map((f) => document.fonts.load(f))); } catch { /* the fallback face is fine */ }
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d')!;
  g.fillStyle = C.paper; g.fillRect(0, 0, W, H);
  round(g, 48, 48, W - 96, H - 96, 36); g.fillStyle = C.card; g.fill();

  // the mark and the name
  g.save(); g.translate(96, 96); g.scale(56 / 256, 56 / 256);
  g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = MARK.stroke;
  g.strokeStyle = C.ink; g.stroke(new Path2D(MARK.box));
  g.strokeStyle = C.hue; g.stroke(new Path2D(MARK.tick));
  g.restore();
  text(g, d.brand, 168, 134, '500 30px', C.ink);
  text(g, d.title, 96, 250, '500 58px', C.ink, W - 192);

  // the day as a column: the hours it spans, each block in place
  const x0 = 96, x1 = 560, top = 320, bottom = 1130;
  const blocks = d.blocks.filter((b) => b.end > b.start);
  if (blocks.length) {
    const r0 = Math.floor(Math.min(...blocks.map((b) => b.start)) / 60) * 60;
    const r1 = Math.ceil(Math.max(...blocks.map((b) => b.end)) / 60) * 60;
    const ppm = (bottom - top) / Math.max(60, r1 - r0);
    const step = (r1 - r0) / 60 > 10 ? 120 : 60;
    g.strokeStyle = C.soft; g.lineWidth = 2;
    for (let m = r0; m <= r1; m += step) {
      const y = top + (m - r0) * ppm;
      g.beginPath(); g.moveTo(x0 + 92, y); g.lineTo(x1, y); g.stroke();
      text(g, d.clock(m), x0, y + 9, '400 24px', C.muted);
    }
    for (const b of blocks) {
      const y = top + (b.start - r0) * ppm + 3, h = Math.max(6, (b.end - b.start) * ppm - 6);
      const deep = b.kind === 'deep';
      round(g, x0 + 104, y, x1 - x0 - 104, h, Math.min(12, h / 2));
      g.fillStyle = deep ? C.ink : b.kind === 'personal' ? C.soft : '#e2e2e2'; g.fill();
      if (h >= 34) text(g, b.label, x0 + 124, y + Math.min(h / 2 + 10, 40), '500 26px', deep ? '#ffffff' : C.ink, x1 - x0 - 140);
    }
  } else {
    text(g, '—', x0, top + 40, '400 40px', C.muted);
  }

  // the numbers
  let y = top + 20;
  for (const s of d.stats) {
    text(g, s.label, 640, y, '400 26px', C.muted);
    text(g, s.value, 640, y + 62, '500 54px', C.ink, W - 640 - 96);
    y += 150;
  }
  if (d.habits.length) {
    y += 10;
    for (const h of d.habits.slice(0, 5)) {
      round(g, 640, y - 26, 32, 32, 7);
      g.lineWidth = 3; g.strokeStyle = h.done ? C.ink : C.faint; g.stroke();
      if (h.done) { g.beginPath(); g.moveTo(648, y - 10); g.lineTo(655, y - 3); g.lineTo(666, y - 18); g.strokeStyle = C.hue; g.lineWidth = 4; g.lineCap = 'round'; g.stroke(); }
      text(g, h.name, 690, y, '400 28px', h.done ? C.ink : C.muted, W - 690 - 96);
      y += 52;
    }
  }

  // the foot: the ritual's last words, with the planner's tick
  g.strokeStyle = C.soft; g.lineWidth = 2; g.beginPath(); g.moveTo(96, 1190); g.lineTo(W - 96, 1190); g.stroke();
  round(g, 96, 1222, 44, 44, 9); g.lineWidth = 3.5; g.strokeStyle = C.ink; g.stroke();
  g.beginPath(); g.moveTo(106, 1245); g.lineTo(116, 1255); g.lineTo(132, 1232); g.strokeStyle = C.hue; g.lineWidth = 5; g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke();
  text(g, d.shutdown, 160, 1256, '500 34px', C.ink, W - 256);
}

function round(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

function text(g: CanvasRenderingContext2D, s: string, x: number, y: number, font: string, colour: string, max?: number) {
  g.font = `${font} ${FONT}`;
  g.fillStyle = colour;
  let t = s;
  if (max) while (t.length > 1 && g.measureText(t).width > max) t = t.slice(0, -2) + '…';
  g.fillText(t, x, y);
}
