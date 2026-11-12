// The planner's mark ("Signed off"): the "Shutdown complete" checkbox of the paper planner, its tick running out
// through the corner it opens. One source for the app (components/Icons.tsx), the favicon and the app icons
// (tools/make-icons.mjs, which imports this file through Node's TypeScript stripping).
//
// Construction on a 256 grid: the box is a 152-unit square (centre line), corner radius 20, stroke 24, open at its
// top-right corner; the tick has two 45° arms (vertex 108,160) and its long arm runs along x + y = 268, so the two
// open ends of the box sit at the same distance from it (27 units of air on each side). The whole mark is set 8
// units left of centre so the box, which carries the weight, sits in the middle.

export const MARK = {
  viewBox: '0 0 256 256',
  box: 'M144 52H64a20 20 0 0 0-20 20v112a20 20 0 0 0 20 20h112a20 20 0 0 0 20-20v-40',
  tick: 'M72 124l36 36 106-106',
  /** stroke at normal sizes; the small cut (favicon, 16-32 px) is a little heavier */
  stroke: 24,
  strokeSmall: 30,
  ink: '#0a0a0a',
  hue: '#1d5fbf',
  inkDark: '#f2f2f2',
  hueDark: '#5b93ef',
} as const;

/** The mark as a standalone SVG file (favicon, icons): ink box, tick in the hue; a dark tab gets the light pair. */
export function markSvg({ small = false, size = 256, ground = '' }: { small?: boolean; size?: number; ground?: string } = {}) {
  const w = small ? MARK.strokeSmall : MARK.stroke;
  const bg = ground ? `<rect width="256" height="256" fill="${ground}"/>` : '';
  const scheme = ground ? '' : `<style>.b{stroke:${MARK.ink}}.t{stroke:${MARK.hue}}@media (prefers-color-scheme:dark){.b{stroke:${MARK.inkDark}}.t{stroke:${MARK.hueDark}}}</style>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK.viewBox}" width="${size}" height="${size}">${scheme}${bg}`
    + `<g fill="none" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">`
    + `<path class="b" d="${MARK.box}"${ground ? ` stroke="${MARK.ink}"` : ''}/>`
    + `<path class="t" d="${MARK.tick}"${ground ? ` stroke="${MARK.hue}"` : ''}/></g></svg>`;
}
