// A project's colour: one of the planner's tones, all within the black, white, grey and blue palette.
import { useT } from '../../lib/i18n';
import { type Background } from '../../lib/model';
import { BGS, HEX, bgLook } from '../../lib/boards';

/**
 * The background of a project's boards: none (the planner's own ground) or one of a few deep solid tones in grey and
 * blue (user, 2026-11-17: the palette is black, white, grey and blue, so there is no colour of one's own any more).
 * A colour picked earlier stays on the project, shown as the grey of the same lightness, until another tone is chosen.
 * The colour is the project's tile on the boards page; the project's own pages keep the planner's ground.
 */
export function BgPicker({ value, onChange }: { value?: Background; onChange: (bg: Background | undefined) => void }) {
  const T = useT();
  const own = value && HEX.test(value) ? value : null;
  return (
    <div className="kb-bgs" role="group" aria-label={T.kbBackground}>
      <span className="kb-pop-label">{T.kbBackground}</span>
      <div className="kb-bg-grid">
        <button type="button" className="kb-bg none" aria-pressed={!value} onClick={() => onChange(undefined)}><span>{T.kbBgNames.none}</span></button>
        {BGS.map((bg) => <button key={bg} type="button" className={`kb-bg bg-${bg}`} aria-pressed={value === bg} onClick={() => onChange(bg)}><span>{T.kbBgNames[bg]}</span></button>)}
        {own && <button type="button" className={`kb-bg own${bgLook(own).className}`} style={bgLook(own).style} aria-pressed title={T.kbBgOwn}><span>{T.kbBgOwnShort}</span></button>}
      </div>
    </div>
  );
}
