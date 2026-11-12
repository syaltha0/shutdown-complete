// A project's colour: the planner's tones or a colour of one's own, picked in place.
import { useEffect, useRef, useState } from 'react';
import { IconPlus } from '../../components/Icons';
import { useT } from '../../lib/i18n';
import { type Background } from '../../lib/model';
import { BGS, HEX, bgLook } from '../../lib/boards';

const RECENT = 'sc-recent-colours';
const recentColours = (): string[] => { try { return (JSON.parse(localStorage.getItem(RECENT) || '[]') as string[]).filter((x) => HEX.test(x)); } catch { return []; } };
function rememberColour(hex: string) {
  try { localStorage.setItem(RECENT, JSON.stringify([hex, ...recentColours().filter((x) => x !== hex)].slice(0, 8))); } catch { /* private window */ }
}

type HSV = { h: number; s: number; v: number };
function hexToHsv(hex: string): HSV {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}
function hsvToHex({ h, s, v }: HSV) {
  const f = (n: number) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return `#${[f(5), f(3), f(1)].map((x) => { const n = Math.round(x * 255); return (n < 16 ? '0' : '') + n.toString(16); }).join('')}`;
}
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * The background of a project's boards: none (the planner's own ground), one of a few deep solid tones, or a colour
 * of one's own. Its own colour is picked in place: a field of saturation and brightness, a strip of hues, the colour
 * code and the colours picked lately (on this device). The colour is the project's tile on the boards page; the
 * project's own pages keep the planner's ground.
 */
export function BgPicker({ value, onChange }: { value?: Background; onChange: (bg: Background | undefined) => void }) {
  const T = useT();
  const own = value && HEX.test(value) ? value : null;
  const [open, setOpen] = useState(!!own);
  const [hsv, setHsv] = useState<HSV>(() => hexToHsv(own ?? recentColours()[0] ?? '#3d6fb6'));
  const [hex, setHex] = useState(own ?? '');
  const [recent, setRecent] = useState(recentColours);
  const last = useRef<string | null>(own);
  // a colour set from elsewhere (another device, the code field) moves the thumbs
  useEffect(() => { if (own && own !== last.current) { last.current = own; setHsv(hexToHsv(own)); setHex(own); } }, [own]);
  const apply = (next: HSV, keep = false) => {
    setHsv(next);
    const h = hsvToHex(next) as Background;
    last.current = h;
    setHex(h);
    onChange(h);
    if (keep) { rememberColour(h); setRecent(recentColours()); }
  };
  const pickHex = (h: string) => { last.current = h; setHsv(hexToHsv(h)); setHex(h); onChange(h as Background); rememberColour(h); setRecent(recentColours()); };
  function drag(e: React.PointerEvent<HTMLElement>, at: (x: number, y: number, r: DOMRect) => HSV) {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const r = el.getBoundingClientRect();
    let cur = at(e.clientX, e.clientY, r);
    apply(cur);
    const move = (ev: PointerEvent) => { cur = at(ev.clientX, ev.clientY, r); apply(cur); };
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); apply(cur, true); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }
  const step = (e: React.KeyboardEvent, dx: number, dy: number) => { e.preventDefault(); apply({ ...hsv, s: clamp01(hsv.s + dx), v: clamp01(hsv.v + dy) }, true); };
  const shown = own ?? hsvToHex(hsv);
  const look = bgLook(own ?? undefined);
  return (
    <div className="kb-bgs cp" role="group" aria-label={T.kbBackground}>
      <span className="kb-pop-label">{T.kbBackground}</span>
      <div className="kb-bg-grid">
        <button type="button" className="kb-bg none" aria-pressed={!value} onClick={() => { setOpen(false); onChange(undefined); }}><span>{T.kbBgNames.none}</span></button>
        {BGS.map((bg) => <button key={bg} type="button" className={`kb-bg bg-${bg}`} aria-pressed={value === bg} onClick={() => { setOpen(false); onChange(bg); }}><span>{T.kbBgNames[bg]}</span></button>)}
        <button type="button" className={`kb-bg own${own ? look.className : ' unset'}`} style={look.style} aria-pressed={!!own} aria-expanded={open} title={T.kbBgOwnPick}
          onClick={() => { setOpen(true); if (!own) apply(hsv, true); }}>
          {!own && <IconPlus />}
          <span>{T.kbBgOwnShort}</span>
        </button>
      </div>
      {open && (
        <div className="cp-panel" style={{ '--cp-h': hsv.h } as React.CSSProperties}>
          <div className="cp-field" role="slider" tabIndex={0} aria-label={T.kbBgShade} aria-valuetext={shown}
            aria-valuenow={Math.round(hsv.s * 100)} aria-valuemin={0} aria-valuemax={100}
            onPointerDown={(e) => drag(e, (x, y, r) => ({ ...hsv, s: clamp01((x - r.left) / r.width), v: clamp01(1 - (y - r.top) / r.height) }))}
            onKeyDown={(e) => {
              const k = e.shiftKey ? 0.1 : 0.02;
              if (e.key === 'ArrowLeft') step(e, -k, 0);
              if (e.key === 'ArrowRight') step(e, k, 0);
              if (e.key === 'ArrowUp') step(e, 0, k);
              if (e.key === 'ArrowDown') step(e, 0, -k);
            }}>
            <span className="cp-thumb" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: shown }} />
          </div>
          <div className="cp-hue" role="slider" tabIndex={0} aria-label={T.kbBgHue} aria-valuenow={Math.round(hsv.h)} aria-valuemin={0} aria-valuemax={360}
            onPointerDown={(e) => drag(e, (x, _y, r) => ({ ...hsv, h: clamp01((x - r.left) / r.width) * 359.9 }))}
            onKeyDown={(e) => {
              const k = e.shiftKey ? 30 : 5;
              if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); apply({ ...hsv, h: (hsv.h - k + 360) % 360 }, true); }
              if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); apply({ ...hsv, h: (hsv.h + k) % 360 }, true); }
            }}>
            <span className="cp-hue-thumb" style={{ left: `${(hsv.h / 360) * 100}%` }} />
          </div>
          <div className="cp-code">
            <span className="cp-now" style={{ background: shown }} aria-hidden="true" />
            <label className="kb-bg-hex">
              <span className="sr-only">{T.kbBgHex}</span>
              <span className="cp-hash" aria-hidden="true">#</span>
              <input className="input num" value={hex.replace(/^#/, '')} placeholder="3d6fb6" maxLength={7} spellCheck={false} aria-label={T.kbBgHex}
                onChange={(e) => {
                  const v = e.target.value.trim().replace(/^#/, '');
                  setHex(`#${v}`);
                  if (HEX.test(`#${v}`)) pickHex(`#${v.toLowerCase()}`);
                }} />
            </label>
          </div>
          {recent.length > 0 && (
            <div className="cp-sets">
              <span className="kb-pop-label">{T.kbBgRecent}</span>
              <div className="kb-bg-grid">
                {recent.map((c) => (
                  <button key={c} type="button" className={`kb-bg cp-recent${bgLook(c as Background).className}`} style={bgLook(c as Background).style} aria-label={c} title={c} aria-pressed={own === c} onClick={() => pickHex(c)} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
