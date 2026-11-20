// A project open: its head, members, board tabs and the board picked; old board links.
import { useEffect, useState } from 'react';
import { DocNotice, SaveStamp } from '../../components/Common';
import { IconBoard, IconLeft, IconMore, IconPlus } from '../../components/Icons';
import { api } from '../../lib/api';
import { useT } from '../../lib/i18n';
import { emptyTeam, type Board, type ProjectData, type TeamDoc } from '../../lib/model';
import { navigate, onLinkClick } from '../../lib/router';
import { useSocial } from '../../lib/social';
import { refreshTeams, useTeams, type Team } from '../../lib/teams';
import { insertAt, offerUndo } from '../../lib/undo';
import { dropKey, refreshKey, useDoc } from '../../lib/useDoc';
import { markOpened } from '../../lib/boards';
import { Faces, Pop, usePersonal } from './shared';
import { BgPicker } from './BgPicker';
import { NewBoardDialog, NewBoardForm } from './NewBoard';
import { BoardView } from './BoardView';

/** A personal project, from the account's own boards document. */
export function PersonalProject({ pid, bid, card }: { pid: string; bid?: string; card?: string }) {
  const T = useT();
  const { value: doc, update, status, error, retry, projects } = usePersonal();
  const project = projects.find((p) => p.id === pid) ?? null;
  useEffect(() => { if (doc?.projects && !project) navigate('/boards', true); }, [doc, project]);
  useEffect(() => { markOpened(pid); }, [pid]);
  if (!project) return <><div className="title-row"><div><h1>{T.nav.boards}</h1></div></div><DocNotice status={status} error={error} retry={retry} /></>;
  const set = (fn: (p: ProjectData) => ProjectData) => update((d) => ({ ...d, projects: (d.projects ?? []).map((p) => (p.id === pid ? { ...p, ...fn(p) } : p)) }));
  return <ProjectView data={project} set={set} base={`/project/${pid}`} bid={bid} card={card} status={status} error={error} retry={retry} />;
}

/** A team project: its shared document, fetched again every few seconds while it is open, and its members. */
export function TeamProject({ tid, bid, card }: { tid: string; bid?: string; card?: string }) {
  const T = useT();
  const key = `team:${tid}`;
  const { value, update, status, error, retry } = useDoc<TeamDoc>(key, emptyTeam);
  const teams = useTeams();
  const team = teams?.find((t) => t.id === tid) ?? null;
  useEffect(() => { if (teams && !team) navigate('/boards', true); }, [teams, team]);
  useEffect(() => { markOpened(tid); }, [tid]);
  // Keep fast collaboration polling; the common reader coalesces requests and protects local edits.
  useEffect(() => {
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') refreshKey(key, 4000); }, 4000);
    return () => window.clearInterval(t);
  }, [key]);
  if (!value || !team || !value.name && !value.boards) return <><div className="title-row"><div><h1>{T.nav.boards}</h1></div></div><DocNotice status={status} error={error} retry={retry} /></>;
  return <ProjectView data={value} set={update} base={`/team/${tid}`} bid={bid} card={card} status={status} error={error} retry={retry} team={team} />;
}

/** A project open: where it is, its people (a team project), its boards as tabs, and the board picked. */
function ProjectView({ data, set, base, bid, card, status, error, retry, team }: {
  data: ProjectData; set: (fn: (p: ProjectData) => ProjectData) => void; base: string; bid?: string; card?: string;
  status: Parameters<typeof SaveStamp>[0]['status']; error: string | null; retry: () => void; team?: Team;
}) {
  const T = useT();
  const [creating, setCreating] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const board = data.boards.find((b) => b.id === bid) ?? null;
  useEffect(() => { if (!board && data.boards.length) navigate(`${base}/${data.boards[0].id}`, true); }, [board, data.boards.length]); // eslint-disable-line react-hooks/exhaustive-deps

  function create(b: Board) {
    set((p) => ({ ...p, boards: [...p.boards, b] }));
    setCreating(false);
    navigate(`${base}/${b.id}`);
  }
  function removeBoard(id: string) {
    const at = data.boards.findIndex((b) => b.id === id), b0 = data.boards[at];
    const next = data.boards[at + 1] ?? data.boards[at - 1];
    set((p) => ({ ...p, boards: p.boards.filter((b) => b.id !== id) }));
    offerUndo(T.deleted(b0.name), () => set((p) => ({ ...p, boards: insertAt(p.boards, at, b0) })));
    navigate(next ? `${base}/${next.id}` : base, true);
  }
  const setBoard = (fn: (b: Board) => Board) => set((p) => ({ ...p, boards: p.boards.map((b) => (b.id === bid ? fn(b) : b)) }));

  return (
    <div className="kb-board">
      <header className="kb-proj">
        <a className="kb-back" href="/boards" onClick={onLinkClick} aria-label={T.nav.boards}><IconLeft /><span>{T.nav.boards}</span></a>
        <div className="kb-proj-name">
          <h1>{data.name || T.kbUntitled}</h1>
          {team && <span className="kb-team-tag">{T.kbTeam}</span>}
          {data.description && <ProjectDescription text={data.description} />}
        </div>
        <div className="kb-proj-end">
          {team && (
            <div className="kb-pop-wrap">
              <button type="button" className="btn kb-bar-btn kb-members-btn" aria-expanded={menu === 'people'} onClick={() => setMenu(menu === 'people' ? null : 'people')}>
                <Faces members={team.members} /><span>{T.kbMembers}</span>
              </button>
              <Pop open={menu === 'people'} onClose={() => setMenu(null)} title={T.kbMembers} align="right" className="kb-people-pop">
                <Members team={team} />
              </Pop>
            </div>
          )}
          <div className="kb-pop-wrap">
            <button type="button" className="btn kb-bar-btn" aria-label={T.kbProjectMenu(data.name)} aria-expanded={menu === 'project'} onClick={() => setMenu(menu === 'project' ? null : 'project')}><IconMore /><span>{T.kbProject}</span></button>
            <Pop open={menu === 'project'} onClose={() => setMenu(null)} title={T.kbProject} align="right">
              <BgPicker value={data.background} onChange={(bg) => set((p) => ({ ...p, background: bg }))} />
              <ProjectEdit data={data} set={set} />
            </Pop>
          </div>
        </div>
      </header>

      {data.boards.length > 0 && <nav className="kb-tabs" aria-label={T.kbBoardsOf(data.name)}>
        <span className="kb-tab-list">
          {data.boards.map((b) => (
            <a key={b.id} className="kb-tab" href={`${base}/${b.id}`} onClick={onLinkClick} aria-current={b.id === bid ? 'page' : undefined}><IconBoard />{b.name || T.kbName}</a>
          ))}
        </span>
        <button type="button" className="kb-tab add" aria-label={T.kbNewBoard} title={T.kbNewBoard} onClick={() => setCreating(true)}><IconPlus /></button>
      </nav>}

      {board ? (
        <BoardView projectActions={<><BgPicker value={data.background} onChange={(bg) => set((p) => ({ ...p, background: bg }))} /><ProjectEdit data={data} set={set} /></>} key={board.id} project={base.startsWith('/team/') ? `t:${base.slice(6)}` : `p:${base.slice(9)}`} board={board} setBoard={setBoard} onDelete={() => removeBoard(board.id)} card={card} status={status} error={error} retry={retry} />
      ) : data.boards.length === 0 ? (
        <section className="panel kb-start kb-first" aria-labelledby="kb-start-h">
          <header>
            <h2 id="kb-start-h">{T.kbFirstBoardOf(data.name || T.kbUntitled)}</h2>
            <p className="muted">{T.kbFirstBoardBody}</p>
          </header>
          <NewBoardForm onCreate={create} autoFocus page team={!!team} />
        </section>
      ) : null}
      <NewBoardDialog open={creating} onClose={() => setCreating(false)} onCreate={create} team={!!team} />
    </div>
  );
}

/** The project's title and description, changed in the project menu. */
function ProjectEdit({ data, set }: { data: ProjectData; set: (fn: (p: ProjectData) => ProjectData) => void }) {
  const T = useT();
  const [name, setName] = useState(data.name);
  const [desc, setDesc] = useState(data.description ?? '');
  return (
    <form className="kb-proj-edit" onSubmit={(e) => { e.preventDefault(); if (name.trim()) set((p) => ({ ...p, name: name.trim(), description: desc.trim() })); }}>
      <label className="kb-pop-label" htmlFor="kpe-name">{T.kbProjectTitle}</label>
      <input id="kpe-name" className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
      <label className="kb-pop-label" htmlFor="kpe-desc">{T.kbProjectDesc}</label>
      <textarea id="kpe-desc" className="input" rows={3} maxLength={2000} value={desc} onChange={(e) => setDesc(e.target.value)} />
      <div><button type="submit" className="btn primary sm" disabled={!name.trim() || (name.trim() === data.name && desc.trim() === (data.description ?? ''))}>{T.kbSave}</button></div>
    </form>
  );
}

/** The people in a team project; the owner adds friends and removes members, a member may leave. */
function Members({ team }: { team: Team }) {
  const T = useT();
  const social = useSocial();
  const [busy, setBusy] = useState(false);
  const free = (social?.friends ?? []).filter((f) => !team.members.some((m) => m.id === f.id));
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); await refreshTeams(); } finally { setBusy(false); } };
  return (
    <div className="kb-people">
      <ul>
        {team.members.map((m) => (
          <li key={m.id}>
            <Faces members={[m]} />
            <span className="kb-person">{m.name}{m.you ? ` (${T.kbYou})` : ''}</span>
            {m.role === 'owner' ? <small className="muted">{T.kbOwner}</small>
              : team.owner ? <button type="button" className="btn ghost sm" disabled={busy} onClick={() => run(() => api.removeTeamMember(team.id, m.id))}>{T.kbRemove}</button>
                : m.you ? <button type="button" className="btn ghost sm" disabled={busy} onClick={() => run(async () => { await api.removeTeamMember(team.id, m.id); dropKey(`team:${team.id}`); navigate('/boards'); })}>{T.kbLeave}</button> : null}
          </li>
        ))}
      </ul>
      {team.owner && (
        <>
          <span className="kb-pop-label">{T.kbAddMember}</span>
          {free.length ? (
            <ul>
              {free.map((f) => (
                <li key={f.id}>
                  <Faces members={[f]} /><span className="kb-person">{f.name}</span>
                  <button type="button" className="btn sm" disabled={busy} onClick={() => run(() => api.addTeamMember(team.id, f.id))}>{T.kbAdd}</button>
                </li>
              ))}
            </ul>
          ) : <p className="muted kb-people-none">{social ? T.kbNoFriends : '…'} {social && <a href="/focus" onClick={onLinkClick}>{T.kbToFriends}</a>}</p>}
        </>
      )}
    </div>
  );
}

/** An old link to a board (before projects): to the board in its project. */
export function LegacyBoard({ id, card }: { id: string; card?: string }) {
  const { value: doc, projects } = usePersonal();
  useEffect(() => {
    if (!doc?.projects) return;
    const p = projects.find((x) => x.boards.some((b) => b.id === id));
    navigate(p ? `/project/${p.id}/${id}${card ? `/${card}` : ''}` : '/boards', true);
  }, [doc]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** A project's description: two lines, and the rest a tap away (no hover needed on a phone). */
function ProjectDescription({ text }: { text: string }) {
  const T = useT();
  const [open, setOpen] = useState(false);
  const long = text.length > 140 || /\n/.test(text);
  return <div className="kb-proj-desc-wrap">
    <p className="kb-proj-desc" data-open={open || !long}>{text}</p>
    {long && <button type="button" className="kb-proj-more" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? T.kbLess : T.kbMore}</button>}
  </div>;
}
