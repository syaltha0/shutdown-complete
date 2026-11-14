// The boards page: projects (personal and team), board templates, cards due soon.
import { useEffect, useRef, useState } from 'react';
import { DocNotice, SaveStamp } from '../../components/Common';
import { IconMore, IconPencil, IconPlus, IconSearch, IconTrash } from '../../components/Icons';
import { Segmented } from '../../components/Segmented';
import { dueWords } from '../../components/TaskMeta';
import { api } from '../../lib/api';
import { today } from '../../lib/dates';
import { useT } from '../../lib/i18n';
import { emptyTeam, uid, type BoardTemplate, type Project, type ProjectData, type TeamDoc } from '../../lib/model';
import { navigate, onLinkClick } from '../../lib/router';
import { refreshTeams, useTeams, type Team } from '../../lib/teams';
import { insertAt, offerUndo } from '../../lib/undo';
import { dropKey, updateKey } from '../../lib/useDoc';
import { bgLook, cardsDue, daysTo, markOpened, openedAt } from '../../lib/boards';
import { Faces, Pop, useBoardTemplates, usePersonal } from './shared';
import { BgPicker } from './BgPicker';
import { TemplateDialog } from './NewBoard';

type Show = 'all' | 'personal' | 'team';
type Sort = 'recent' | 'name' | 'created';
type Tile = { kind: 'personal' | 'team'; id: string; href: string; data: ProjectData; team?: Team };

/**
 * The boards page, Planka's projects page: a filter row (search, which projects, the order, favourites only), then two
 * parts: the projects that are only the account's own, and the team projects shared with friends. Each part ends with
 * a tile to make one, which asks for a title and, if wanted, a description. A project holds boards; it opens on them.
 * Under both parts, the cards due within a week across every project.
 */
export function Boards() {
  const T = useT();
  const { value: doc, update, status, error, retry, projects } = usePersonal();
  const teams = useTeams();
  const [query, setQuery] = useState('');
  const [show, setShow] = useState<Show>('all');
  const [sort, setSort] = useState<Sort>(() => { try { return (localStorage.getItem('sc-projects-sort') as Sort) || 'recent'; } catch { return 'recent'; } });
  const [favOnly, setFavOnly] = useState(false);
  const [dialog, setDialog] = useState<{ kind: 'personal' | 'team'; edit?: Tile } | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [sure, setSure] = useState<string | null>(null);
  const favs = doc?.favorites ?? [];
  const opened = openedAt();

  const tiles: Tile[] = [
    ...projects.map((p) => ({ kind: 'personal' as const, id: p.id, href: `/project/${p.id}`, data: p })),
    ...(teams ?? []).map((t) => ({ kind: 'team' as const, id: t.id, href: `/team/${t.id}`, data: t.value, team: t })),
  ];
  const q = query.trim().toLocaleLowerCase();
  const match = (x: Tile) => (!q || x.data.name.toLocaleLowerCase().includes(q) || (x.data.description ?? '').toLocaleLowerCase().includes(q)
    || x.data.boards.some((b) => b.name.toLocaleLowerCase().includes(q))) && (!favOnly || favs.includes(x.id));
  const order = (a: Tile, b: Tile) => (favs.includes(b.id) ? 1 : 0) - (favs.includes(a.id) ? 1 : 0)
    || (sort === 'name' ? a.data.name.localeCompare(b.data.name)
      : sort === 'created' ? (b.data.created ?? '').localeCompare(a.data.created ?? '')
        : (opened[b.id] ?? 0) - (opened[a.id] ?? 0) || (b.data.created ?? '').localeCompare(a.data.created ?? ''));
  const mine = tiles.filter((x) => x.kind === 'personal'), ours = tiles.filter((x) => x.kind === 'team');
  const due = cardsDue(projects, teams).filter((x) => daysTo(x.c.due!) <= 7);
  const filtering = !!q || favOnly;

  const setProject = (id: string, p: Partial<Project>) => update((d) => ({ ...d, projects: (d.projects ?? []).map((x) => (x.id === id ? { ...x, ...p } : x)) }));
  const setTeam = (id: string, p: Partial<TeamDoc>) => updateKey<TeamDoc>(`team:${id}`, emptyTeam, (v) => ({ ...v, ...p })).then(() => window.setTimeout(refreshTeams, 900));
  function favourite(id: string) { update((d) => ({ ...d, favorites: (d.favorites ?? []).includes(id) ? (d.favorites ?? []).filter((x) => x !== id) : [...(d.favorites ?? []), id] })); }

  async function save(name: string, description: string) {
    const d = dialog!;
    if (d.edit) {
      if (d.kind === 'personal') setProject(d.edit.id, { name, description });
      else await setTeam(d.edit.id, { name, description });
    } else if (d.kind === 'personal') {
      const p: Project = { id: uid(), name, description, boards: [], created: today() };
      update((x) => ({ ...x, projects: [...(x.projects ?? []), p] }));
      navigate(`/project/${p.id}`);
    } else {
      const t = await api.createTeam({ name, description });
      await refreshTeams();
      navigate(`/team/${t.id}`);
    }
    setDialog(null);
  }
  function removePersonal(id: string) {
    const all = doc?.projects ?? [];
    const at = all.findIndex((x) => x.id === id), p = all[at];
    if (!p) return;
    update((d) => ({ ...d, projects: (d.projects ?? []).filter((x) => x.id !== id) }));
    offerUndo(T.deleted(p.name), () => update((d) => ({ ...d, projects: insertAt(d.projects ?? [], at, p) })));
  }
  async function removeTeam(t: Team) {
    if (t.owner) await api.deleteTeam(t.id);
    else await api.removeTeamMember(t.id, t.members.find((m) => m.you)!.id);
    dropKey(`team:${t.id}`);
    await refreshTeams();
  }

  const tile = (x: Tile) => {
    const bs = x.data.boards;
    const cards = bs.flatMap((b) => b.lists.flatMap((l) => l.cards));
    const fin = bs.reduce((n, b) => n + (b.lists[b.lists.length - 1]?.cards.length ?? 0), 0);
    const soon = bs.reduce((n, b) => n + b.lists.slice(0, -1).flatMap((l) => l.cards).filter((c) => c.due && daysTo(c.due) <= 7).length, 0);
    const fav = favs.includes(x.id);
    return (
      <article key={x.id} className={`kb-tile${bgLook(x.data.background).className}`} style={bgLook(x.data.background).style} data-anim>
        <a className="kb-tile-link" href={x.href} onClick={(e) => { markOpened(x.id); onLinkClick(e); }}>
          <h3>{x.data.name || T.kbUntitled}</h3>
        </a>
        {x.data.description ? <p className="kb-tile-desc">{x.data.description}</p> : <span />}
        <div className="kb-tile-foot num">
          <span>{T.kbBoardsN(bs.length)}</span>
          {cards.length > 0 && <span>{T.kbProgress(fin, cards.length)}</span>}
          {soon > 0 && <span className="kb-due-chip">{T.kbDueSoon(soon)}</span>}
          {x.team && <Faces members={x.team.members} />}
        </div>
        <div className="kb-tile-tools">
          <button type="button" className={`btn ghost icon kb-star${fav ? ' on' : ''}`} aria-pressed={fav} aria-label={T.kbFavorite(x.data.name)} onClick={() => favourite(x.id)}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3.2l2.1 4.3 4.7.7-3.4 3.3.8 4.7-4.2-2.2-4.2 2.2.8-4.7-3.4-3.3 4.7-.7z" /></svg>
          </button>
          <div className="kb-pop-wrap">
            <button type="button" className="btn ghost icon" aria-label={T.kbProjectMenu(x.data.name)} aria-expanded={menu === x.id} onClick={() => { setSure(null); setMenu(menu === x.id ? null : x.id); }}><IconMore /></button>
          </div>
        </div>
        <Pop open={menu === x.id} onClose={() => setMenu(null)} title={T.kbProject} className="kb-tile-pop" beside>
          <BgPicker value={x.data.background} onChange={(bg) => (x.kind === 'personal' ? setProject(x.id, { background: bg }) : setTeam(x.id, { background: bg }))} />
          <div className="kb-menu">
            <button type="button" onClick={() => { setMenu(null); setDialog({ kind: x.kind, edit: x }); }}><IconPencil />{T.kbEditProject}</button>
            {x.kind === 'personal' && <button type="button" className="danger" onClick={() => { setMenu(null); removePersonal(x.id); }}><IconTrash />{T.kbDeleteProject}</button>}
            {x.team && (sure === x.id
              ? <button type="button" className="danger" onClick={() => { setMenu(null); removeTeam(x.team!); }}><IconTrash />{x.team.owner ? T.kbDeleteForAll : T.kbLeaveSure}</button>
              : <button type="button" className="danger" onClick={() => setSure(x.id)}><IconTrash />{x.team.owner ? T.kbDeleteProject : T.kbLeave}</button>)}
          </div>
        </Pop>
      </article>
    );
  };
  const part = (kind: 'personal' | 'team', list: Tile[]) => {
    const shown = list.filter(match).sort(order);
    return (
      <section className="kb-part" aria-labelledby={`kb-${kind}-h`} data-anim>
        <header>
          <h2 id={`kb-${kind}-h`}>{kind === 'personal' ? T.kbPersonal : T.kbTeam}</h2>
          <span className="muted">{kind === 'personal' ? T.kbPersonalAbout : T.kbTeamAbout}</span>
        </header>
        <div className="kb-tiles">
          {shown.map(tile)}
          {!filtering && (
            <button type="button" className={`kb-tile kb-new${kind === 'personal' ? ' kb-first-project' : ''}`} onClick={() => setDialog({ kind })}>
              <IconPlus /><span>{kind === 'personal' ? T.kbCreateProject : T.kbCreateTeamProject}</span>
            </button>
          )}
          {filtering && shown.length === 0 && <p className="muted kb-none">{T.kbNoMatchProjects}</p>}
        </div>
      </section>
    );
  };

  return (
    <>
      <div className="title-row">
        <div>
          <h1>{T.nav.boards}</h1>
          <p className="sub num">{doc ? T.kbProjectsLine(mine.length, ours.length, due.length) : ' '}</p>
        </div>
        <div className="title-actions"><SaveStamp status={status} /></div>
      </div>
      <DocNotice status={status} error={error} retry={retry} />

      <div className="kb-filters" role="search">
        <label className="kb-search wide">
          <IconSearch />
          <span className="sr-only">{T.kbSearchProjects}</span>
          <input className="input" type="search" placeholder={T.kbSearchProjects} value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <Segmented role="group" aria-label={T.kbShowLabel}>
          {(['all', 'personal', 'team'] as Show[]).map((k) => <button key={k} type="button" aria-pressed={show === k} onClick={() => setShow(k)}>{T.kbShow[k]}</button>)}
        </Segmented>
        <label className="kb-sort">
          <span className="muted">{T.kbSort}</span>
          <select className="input" value={sort} onChange={(e) => { const v = e.target.value as Sort; setSort(v); try { localStorage.setItem('sc-projects-sort', v); } catch { /* private window */ } }}>
            {(['recent', 'name', 'created'] as Sort[]).map((k) => <option key={k} value={k}>{T.kbSorts[k]}</option>)}
          </select>
        </label>
        <button type="button" className={`btn kb-fav-only${favOnly ? ' on' : ''}`} aria-pressed={favOnly} onClick={() => setFavOnly(!favOnly)}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3.2l2.1 4.3 4.7.7-3.4 3.3.8 4.7-4.2-2.2-4.2 2.2.8-4.7-3.4-3.3 4.7-.7z" /></svg>{T.kbFavOnly}
        </button>
      </div>

      {show !== 'team' && part('personal', mine)}
      {show !== 'personal' && part('team', ours)}
      {show !== 'team' && !filtering && <TemplatesPart />}

      {due.length > 0 && (
        <section className="panel kb-soon" aria-labelledby="kb-soon-h" data-anim>
          <header><h2 id="kb-soon-h">{T.kbSoon}</h2><span className="meta num">{T.kbSoonMeta(due.length)}</span></header>
          <ul className="home-list dates">
            {due.slice(0, 8).map((x) => (
              <li key={x.c.id}>
                <span className={`kb-due-chip${daysTo(x.c.due!) < 0 ? ' late' : daysTo(x.c.due!) === 0 ? ' today' : ''}`}>{dueWords(T, x.c.due!)}</span>
                <a className="kb-soon-title" href={x.href} onClick={onLinkClick}>{x.c.title}</a>
                <small className="muted">{x.project} · {x.board}</small>
              </li>
            ))}
          </ul>
        </section>
      )}
      <ProjectDialog value={dialog} onClose={() => setDialog(null)} onSave={save} />
    </>
  );
}

/** Making or changing a project: a title, and a description if wanted. */
function ProjectDialog({ value, onClose, onSave }: { value: { kind: 'personal' | 'team'; edit?: Tile } | null; onClose: () => void; onSave: (name: string, description: string) => Promise<void> }) {
  const T = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (value && !d.open) { d.showModal(); setName(value.edit?.data.name ?? ''); setDesc(value.edit?.data.description ?? ''); setErr(''); setBusy(false); }
    if (!value && d.open) d.close();
  }, [value]);
  const team = value?.kind === 'team';
  return (
    <dialog ref={ref} className="sheet kb-sheet" onClose={onClose} aria-labelledby="kp-h">
      {value && (
        <form className="kp-form" onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim() || busy) return;
          setBusy(true); setErr('');
          try { await onSave(name.trim(), desc.trim()); } catch { setErr(T.kbCouldNot); setBusy(false); }
        }}>
          <h2 id="kp-h">{value.edit ? T.kbEditProject : team ? T.kbCreateTeamProject : T.kbCreateProject}</h2>
          {!value.edit && <p className="muted">{team ? T.kbTeamNote : T.kbPersonalNote}</p>}
          <div className="field">
            <label htmlFor="kp-name">{T.kbProjectTitle}</label>
            <input id="kp-name" className="input" autoFocus maxLength={120} value={name} placeholder={T.kbProjectTitlePh} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="kp-desc">{T.kbProjectDesc} <span className="muted">{T.kbOptional}</span></label>
            <textarea id="kp-desc" className="input" rows={3} maxLength={2000} value={desc} placeholder={T.kbProjectDescPh} onChange={(e) => setDesc(e.target.value)} />
          </div>
          {err && <p className="err-line" role="alert">{err}</p>}
          <div className="foot">
            <button type="button" className="btn ghost" onClick={onClose}>{T.cancel}</button>
            <div className="right"><button type="submit" className="btn primary" disabled={!name.trim() || busy}>{value.edit ? T.kbSave : T.kbCreate}</button></div>
          </div>
        </form>
      )}
    </dialog>
  );
}

/** The board templates of one's own, on the boards page: each one a tile; a click changes it. */
function TemplatesPart() {
  const T = useT();
  const { templates, remove, restore } = useBoardTemplates();
  const [dialog, setDialog] = useState<{ edit?: BoardTemplate } | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  return (
    <section className="kb-part" aria-labelledby="kb-tpls-h" data-anim>
      <header>
        <h2 id="kb-tpls-h">{T.kbTemplatesPart}</h2>
        <span className="muted">{T.kbTemplatesAbout}</span>
      </header>
      <div className="kb-tiles">
        {templates.map((t, at) => {
          const cards = t.lists.reduce((n, l) => n + (l.cards?.length ?? 0), 0);
          return (
            <article key={t.id} className="kb-tile kb-tpl-tile" data-anim>
              <button type="button" className="kb-tile-link" onClick={() => setDialog({ edit: t })}><h3>{t.name}</h3></button>
              <span className="kb-tpl-chips" aria-hidden="true">{t.lists.map((l, i) => <i key={i}>{l.name}</i>)}</span>
              <div className="kb-tile-foot num">
                <span>{T.kbLists(t.lists.length)}</span>
                {cards > 0 && <span>{T.kbCardsN(cards)}</span>}
                {t.labels.length > 0 && <span className="kb-tpl-dots">{t.labels.map((l, i) => <i key={i} className={`lb-${l.color}`} title={l.name} />)}</span>}
              </div>
              <div className="kb-tile-tools">
                <div className="kb-pop-wrap">
                  <button type="button" className="btn ghost icon" aria-label={T.kbProjectMenu(t.name)} aria-expanded={menu === t.id} onClick={() => setMenu(menu === t.id ? null : t.id)}><IconMore /></button>
                </div>
              </div>
              <Pop open={menu === t.id} onClose={() => setMenu(null)} title={T.kbTplOne} className="kb-tile-pop" beside>
                <div className="kb-menu">
                  <button type="button" onClick={() => { setMenu(null); setDialog({ edit: t }); }}><IconPencil />{T.kbTplEdit}</button>
                  <button type="button" className="danger" onClick={() => { setMenu(null); remove(t.id); offerUndo(T.deleted(t.name), () => restore(t, at)); }}><IconTrash />{T.kbTplDelete}</button>
                </div>
              </Pop>
            </article>
          );
        })}
        <button type="button" className="kb-tile kb-new" onClick={() => setDialog({})}><IconPlus /><span>{T.kbTplMake}</span></button>
      </div>
      <TemplateDialog value={dialog} onClose={() => setDialog(null)} />
    </section>
  );
}
