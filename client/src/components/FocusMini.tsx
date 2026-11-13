import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSettings } from '../App';
import { mmss, pauseFocus, resumeFocus, secondsLeft, settingsFocus, useFocusDay } from '../lib/focus';
import { useT } from '../lib/i18n';
import { Ring, useTick } from './FocusTimer';

type Pip = {requestWindow: (options: {width: number; height: number}) => Promise<Window>};
export function FocusMini() {
  const T = useT(), {settings} = useSettings(), f = settingsFocus(settings);
  const {active: a, key} = useFocusDay();
  useTick(!!a && a.pausedLeft == null);
  const [pip, setPip] = useState<Window | null>(null);
  const pending = useRef(false);
  const api = (window as Window & {documentPictureInPicture?: Pip}).documentPictureInPicture;
  async function open() {
    if (!api || pending.current) return;
    if (pip && !pip.closed) { pip.focus(); return; }
    pending.current = true;
    try {
      const w = await api.requestWindow({width: 280, height: 340});
      for (const node of document.querySelectorAll('style, link[rel="stylesheet"]')) w.document.head.append(node.cloneNode(true));
      w.document.documentElement.dataset.theme = document.documentElement.dataset.theme;
      w.document.title = T.focusOptions.mini;
      w.addEventListener('pagehide', () => setPip(null), {once: true});
      setPip(w);
    } catch { /* user denied the window */ } finally { pending.current = false; }
  }
  useEffect(() => { const close = () => pip?.close(); window.addEventListener('pagehide', close); return () => { window.removeEventListener('pagehide', close); pip?.close(); }; }, [pip]);
  useEffect(() => { const openMini = () => void open(); window.addEventListener('sc:mini', openMini); return () => window.removeEventListener('sc:mini', openMini); });
  if (!api) return null;
  return <><button className="btn ghost sm" onClick={() => void open()}>{T.focusOptions.mini}</button>{pip && createPortal(<div className={`focus-stage phase-${a?.phase ?? 'focus'}`}><div className="focus-ring">{a && <Ring a={a} size={220} stroke={5} />}<div className="focus-read"><b className="num">{mmss(a ? secondsLeft(a) : f.focusMin * 60)}</b></div></div>{a && <button className="btn" disabled={!!f.strict && a.phase === 'focus'} onClick={() => a.pausedLeft == null ? pauseFocus(key) : resumeFocus(key)}>{a.pausedLeft == null ? T.pause : T.resume}</button>}</div>, pip.document.body)}</>;
}
