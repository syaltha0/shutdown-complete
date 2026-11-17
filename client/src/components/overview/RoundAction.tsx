import { useEffect, useRef, useState } from "react";
import { onLinkClick } from "../../lib/router";
import { useT } from "../../lib/i18n";
import { IconX } from "../Icons";

/** An empty card's one action: a thin round button with its title and a line of help.
 *  "row" puts the circle left of the words (wide cards), "stack" centres it above them (square cards). */
export function RoundAction({ title, hint, href, onClick, icon = "plus", layout = "row" }: {
  title: string; hint: string; href?: string; onClick?: () => void; icon?: "plus" | "play"; layout?: "row" | "stack";
}) {
  const glyph = <span className="b-round" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {icon === "play" ? <path d="M9.5 7.5v9l7-4.5z" /> : <path d="M12 6v12M6 12h12" />}
    </svg>
  </span>;
  const words = <span className="b-round-text"><b>{title}</b><small>{hint}</small></span>;
  return href
    ? <a className="b-round-action" data-layout={layout} href={href} onClick={onLinkClick}>{glyph}{words}</a>
    : <button type="button" className="b-round-action" data-layout={layout} onClick={onClick}>{glyph}{words}</button>;
}

/** A small dialog that adds one task straight onto today's list. */
export function AddTodayDialog({ onAdd, onClose }: { onAdd: (text: string) => void; onClose: () => void }) {
  const T = useT(), B = T.bento;
  const [text, setText] = useState("");
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const previous = document.activeElement, modal = dialog.current;
    modal?.showModal(); input.current?.focus();
    return () => { modal?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={dialog} className="quick-capture" aria-label={B.addToday} onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === dialog.current) onClose(); }}>
    <form onSubmit={e => { e.preventDefault(); const value = text.trim(); if (!value) return; onAdd(value); onClose(); }}>
      <div className="more-head"><b>{B.addToday}</b><button type="button" className="btn ghost icon" aria-label={T.close} onClick={onClose}><IconX /></button></div>
      <input ref={input} className="input" aria-label={B.addToday} placeholder={B.openCapture} value={text} onChange={e => setText(e.target.value)} />
      <button type="submit" className="btn" disabled={!text.trim()}>{B.addTodayButton}</button>
    </form>
  </dialog>;
}
