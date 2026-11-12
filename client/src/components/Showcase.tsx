import { useEffect, useRef, useState } from 'react';
import { getLang } from '../lib/i18n';
import { useA } from '../lib/i18n-auth';
import { reducedMotion } from '../lib/theme';

/**
 * The tutorial beside the sign-in form: one finished film per language, five short chapters of the planner in use.
 * Everything is in the picture: chapter cards, the window, the camera, the cursor, the spotlight and the step captions
 * are drawn into the film by tools/tutorial (render.mjs), so the page only plays it and nothing can drift from it.
 * The bars on top show the progress and jump to a chapter, with a crossfade from the frame that was showing.
 * Chapter times come from /tutorial/<lang>/tutorial.json; the words are in lib/reel.ts.
 */
interface Chapter { start: number; end: number }
interface Film { duration: number; loopAt: number; chapters: Chapter[] }

export function Showcase() {
  const A = useA();
  const S = A.reel;
  const lang = getLang();
  const [film, setFilm] = useState<Film | null>(null);
  const [cur, setCur] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const snap = useRef<HTMLCanvasElement>(null);
  const fills = useRef<(HTMLElement | null)[]>([]);
  const n = S.scenes.length;

  useEffect(() => {
    let live = true;
    setFilm(null); setCur(0);
    fetch(`/tutorial/${lang}/tutorial.json`).then((r) => r.json()).then((d) => { if (live) setFilm(d); }).catch(() => {});
    return () => { live = false; };
  }, [lang]);

  // plays only while it is on screen
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) v.play().catch(() => {}); else v.pause(); }, { threshold: 0.3 });
    io.observe(v);
    return () => io.disconnect();
  }, [lang]);

  // the bars follow the film; its closing seconds already show the first card again, so they count as the start
  useEffect(() => {
    const v = video.current;
    if (!v || !film) return;
    let raf = 0, ch = -1;
    const tick = () => {
      const t = v.currentTime >= film.loopAt ? 0 : v.currentTime;
      let k = 0;
      while (k + 1 < film.chapters.length && t >= film.chapters[k + 1].start) k++;
      if (k !== ch) { ch = k; setCur(k); }
      film.chapters.forEach((x, i) => {
        const el = fills.current[i];
        if (el) el.style.transform = `scaleX(${i < k ? 1 : i > k ? 0 : Math.min(1, Math.max(0, (t - x.start) / (x.end - x.start)))})`;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [film]);

  // a bar jumps to its chapter: the frame that was showing fades out over the new one
  const jump = (k: number) => {
    const v = video.current, c = snap.current;
    if (!v || !film) return;
    if (c && !reducedMotion() && v.readyState >= 2) {
      c.width = v.videoWidth; c.height = v.videoHeight;
      c.getContext('2d')?.drawImage(v, 0, 0);
      c.className = 'vsnap hold';
      v.addEventListener('seeked', () => requestAnimationFrame(() => { c.className = 'vsnap fade'; }), { once: true });
    }
    v.currentTime = film.chapters[k].start + 0.02;
    v.play().catch(() => {});
  };

  return (
    <aside className="showcase" id="how" aria-label={S.label}>
      <div className="showcase-inner">
        <div>
          <p className="showcase-name">Shutdown Complete</p>
          <p className="showcase-tag">{A.tagline}</p>
        </div>

        <div className="player">
          <div className="segs" role="tablist" aria-label={S.label}>
            {S.scenes.map((sc, k) => (
              <button key={k} type="button" role="tab" className="seg" aria-selected={k === cur}
                aria-label={`${S.sceneN(k + 1, n)}: ${sc.title}`} onClick={() => jump(k)}>
                <i className="seg-fill" ref={(el) => { fills.current[k] = el; }} />
              </button>
            ))}
          </div>

          <div className="vscreen">
            <video ref={video} key={lang} src={`/tutorial/${lang}/tutorial.webm`} poster={`/tutorial/${lang}/poster.jpg`}
              muted loop playsInline preload="auto" tabIndex={-1} aria-label={`${S.sceneN(cur + 1, n)}: ${S.scenes[cur].title}`} />
            <canvas ref={snap} className="vsnap" aria-hidden="true" />
          </div>
        </div>
      </div>
    </aside>
  );
}
