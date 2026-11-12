"""Builds the logo concepts as SVG (black, 256 canvas) plus lockups with the working name set in Jost (outlined).

Needs fontTools (pip install fonttools) and the Jost variable font (OFL, github.com/google/fonts ofl/jost/Jost[wght].ttf):
  python tools/brand/logo-concepts.py "Shutdown Complete"   (JOST=path/to/Jost.ttf, OUT=dir; default OUT tools/brand/.out)
Then: node tools/brand/contact-sheet.mjs (run inside OUT) for a contact sheet of every concept at 160/64/32/16 px.
"""
import math, os, sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

HERE = os.environ.get('OUT') or os.path.join(os.path.dirname(os.path.abspath(__file__)), '.out')
FONT = os.environ.get('JOST') or os.path.join(HERE, 'Jost.ttf')
INK = '#111111'

def f(v):
    return f'{v:.2f}'.rstrip('0').rstrip('.')

def pt(cx, cy, r, deg):  # math angle (CCW, y up) -> svg point
    a = math.radians(deg)
    return (cx + r * math.cos(a), cy - r * math.sin(a))

def svg(body, title, w=256, h=256):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img" '
            f'aria-labelledby="t"><title id="t">{title}</title>{body}</svg>\n')

def stroke(d, w, extra=''):
    return f'<path d="{d}" fill="none" stroke="{INK}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"{extra}/>'

def arc(cx, cy, r, a0, a1):
    """Arc from math angle a0 to a1 going counter-clockwise (a1 > a0)."""
    x0, y0 = pt(cx, cy, r, a0); x1, y1 = pt(cx, cy, r, a1)
    large = 1 if (a1 - a0) % 360 > 180 else 0
    return f'M{f(x0)} {f(y0)} A{f(r)} {f(r)} 0 {large} 0 {f(x1)} {f(y1)}'

def band(x0, y0, x1, y1, w):
    """A straight bar with round ends from (x0,y0) to (x1,y1), as a closed path."""
    dx, dy = x1 - x0, y1 - y0
    L = math.hypot(dx, dy); nx, ny = -dy / L * w / 2, dx / L * w / 2
    r = w / 2
    return (f'M{f(x0+nx)} {f(y0+ny)} L{f(x1+nx)} {f(y1+ny)} A{f(r)} {f(r)} 0 0 0 {f(x1-nx)} {f(y1-ny)} '
            f'L{f(x0-nx)} {f(y0-ny)} A{f(r)} {f(r)} 0 0 0 {f(x0+nx)} {f(y0+ny)} Z')

def rrect(x, y, w, h, r):
    return (f'M{f(x+r)} {f(y)} H{f(x+w-r)} A{r} {r} 0 0 1 {f(x+w)} {f(y+r)} V{f(y+h-r)} A{r} {r} 0 0 1 {f(x+w-r)} {f(y+h)} '
            f'H{f(x+r)} A{r} {r} 0 0 1 {f(x)} {f(y+h-r)} V{f(y+r)} A{r} {r} 0 0 1 {f(x+r)} {f(y)} Z')

C = {}

# ---------------- with the logo-design skill ----------------
# A. Power, done: the power sign (ring r90, stroke 24, open at the top) whose upright stroke is the long arm of a
#    tick; the short arm (52 long, 45 deg) makes the check, so it does not read as an arrow.
cx, cy = 128, 140
ring = arc(cx, cy, 90, 90 + 36, 360 + 90 - 36)
tick = 'M80 116 L128 164 L128 24'
C['skill-a'] = ('Power, done', stroke(ring, 24) + stroke(tick, 24))

# B. Struck through: one time block crossed out the way the planner crosses a block when the day is redrawn; the
#    strike is drawn in the block's own colour outside it and cut out of it inside (even-odd), at exactly 30°.
blk = rrect(36, 80, 184, 100, 24)
t30 = math.tan(math.radians(30))
x0, x1 = 20, 236
y0, y1 = 130 + (128 - x0) * t30, 130 - (x1 - 128) * t30
C['skill-b'] = ('Struck through', f'<path fill="{INK}" fill-rule="evenodd" d="{blk} {band(x0, y0, x1, y1, 20)}"/>')

# C. Day's end: a day set as half a sun under a ruled line; the upper half is an open ring, the lower half solid,
#    the ring's feet stop short of the line (gap 14).
top = arc(128, 121, 84, 8, 172)
half = f'M{f(128-97)} 135 A97 97 0 0 0 {f(128+97)} 135 Z'
C['skill-c'] = ('Day’s end', stroke(top, 26) + f'<path fill="{INK}" d="{half}"/>')

# D. Last line, done: three ruled lines of a list; the last one rises into a tick at 45°.
lines = stroke('M32 54 H224', 32) + stroke('M32 128 H150', 32) + stroke('M32 202 H122 L220 104', 32)
C['skill-d'] = ('Last line, done', lines)

# E. On the hour: the planner's hour ruler (three hour marks) with one time block set against it, starting exactly on
#    an hour and running an hour and a half. (A block over a double rule was tried first: it read as a laptop.)
ticks = stroke('M36 57 H68', 20) + stroke('M36 133 H68', 20) + stroke('M36 209 H68', 20)
C['skill-e'] = ('On the hour', ticks + f'<path fill="{INK}" d="{rrect(96, 47, 124, 124, 22)}"/>')

# ---------------- my own ----------------
# 1. The spread: the paper planner opened flat; the left page is the list (solid), the right page is the hour grid,
#    four hour lines cut out of it.
left = rrect(28, 52, 92, 152, 14)
right = rrect(136, 52, 92, 152, 14)
cuts = ' '.join(rrect(152, y, 60, 10, 5) for y in (78, 108, 138, 168))
C['own-1'] = ('The spread', f'<path fill="{INK}" fill-rule="evenodd" d="{left} {right} {cuts}"/>')

# 2. Off hours: a rounded square (the day) with a crescent taken out of its upper right: evening, the work is put away.
def crescent(c1, r1, c2, r2):
    """The part of circle 1 outside circle 2, as one closed path."""
    (x1, y1), (x2, y2) = c1, c2
    d = math.hypot(x2 - x1, y2 - y1)
    a = (r1 * r1 - r2 * r2 + d * d) / (2 * d); h = math.sqrt(r1 * r1 - a * a)
    mx, my = x1 + a * (x2 - x1) / d, y1 + a * (y2 - y1) / d
    p1 = (mx + h * (y2 - y1) / d, my - h * (x2 - x1) / d)
    p2 = (mx - h * (y2 - y1) / d, my + h * (x2 - x1) / d)
    return (f'M{f(p1[0])} {f(p1[1])} A{r1} {r1} 0 1 0 {f(p2[0])} {f(p2[1])} '
            f'A{r2} {r2} 0 0 1 {f(p1[0])} {f(p1[1])} Z')
# replaced: a moon in a rounded square is the phone's "do not disturb" sign
cover = rrect(52, 24, 152, 184, 18)
# the ribbon hangs out from under the pages, ending in a swallowtail; a thin cut is the spine
ribbon = 'M150 196 H174 V240 L162 228 L150 240 Z'
spine = rrect(74, 24, 10, 184, 0)
C['own-2'] = ('Bookmark', f'<path fill="{INK}" fill-rule="evenodd" d="{cover} {spine}"/><path fill="{INK}" d="{ribbon}"/>')

# 3. Now: an hour column of the planner with the line of "now" across it, ending in the dot (the only colour).
col = f'<path d="{rrect(60, 32, 100, 192, 22)}" fill="none" stroke="{INK}" stroke-width="20"/>'
C['own-3'] = ('Now', col + stroke('M36 142 H184', 14) + '<circle cx="204" cy="142" r="22" fill="#1d5fbf"/>')

# 4. Three blocks, closed: three time blocks in a row; the last is not a block but the tick that ends the day.
b1 = rrect(24, 100, 56, 56, 14); b2 = rrect(96, 100, 56, 56, 14)
C['own-4'] = ('Three blocks', f'<path fill="{INK}" d="{b1} {b2}"/>' + stroke('M174 126 L196 150 L236 92', 22))

# 5. The box, signed off: the planner's "Shutdown complete" checkbox; the tick runs out through the corner it opens.
box = 'M156 52 H72 A20 20 0 0 0 52 72 V184 A20 20 0 0 0 72 204 H184 A20 20 0 0 0 204 184 V132'
C['own-5'] = ('Signed off', stroke(box, 24) + stroke('M92 128 L124 160 L216 52', 24))

# ---------------- wordmark (Jost 500, outlined) ----------------
def wordmark(text, size, weight=500, tracking=0):
    font = TTFont(FONT)
    font = instantiateVariableFont(font, {'wght': weight})
    gs = font.getGlyphSet(); cmap = font.getBestCmap(); upm = font['head'].unitsPerEm
    hmtx = font['hmtx']; s = size / upm
    x = 0; out = []
    for ch in text:
        g = cmap.get(ord(ch))
        if g is None: continue
        pen = SVGPathPen(gs)
        gs[g].draw(TransformPen(pen, (s, 0, 0, -s, x, 0)))
        out.append(pen.getCommands())
        x += hmtx[g][0] * s + tracking
    return ' '.join(out), x - tracking

def lockup(key, name, body):
    text, width = wordmark(name, 76)
    W = int(256 + 40 + width + 24)
    g = f'<g id="symbol">{body}</g><g id="wordmark" transform="translate(296 154)"><path fill="{INK}" d="{text}"/></g>'
    return svg(g, f'{name} lockup', W, 256)

if __name__ == '__main__':
    name = sys.argv[1] if len(sys.argv) > 1 else 'Shutdown Complete'
    for key, (title, body) in C.items():
        d = os.path.join(HERE, key.split('-')[0])
        os.makedirs(d, exist_ok=True)
        open(os.path.join(d, f'{key}.svg'), 'w', encoding='utf-8').write(svg(body, title))
        open(os.path.join(d, f'{key}-lockup.svg'), 'w', encoding='utf-8').write(lockup(key, name, body))
    print('ok', len(C))
