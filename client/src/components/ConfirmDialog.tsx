import { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';

export function ConfirmDialog({ title, text, confirmText, cancelText, onClose }: { title: string; text: string; confirmText: string; cancelText: string; onClose: (accepted: boolean) => void }) {
 const ref = useRef<HTMLDialogElement>(null);
 useEffect(() => { const previous = document.activeElement; const dialog = ref.current; dialog?.showModal(); return () => { dialog?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); }; }, []);
 return <dialog ref={ref} className="quick-capture" aria-labelledby="confirm-title" aria-describedby="confirm-text" onCancel={e => { e.preventDefault(); onClose(false); }}>
  <h2 id="confirm-title">{title}</h2><p id="confirm-text">{text}</p><div className="title-actions"><button type="button" className="btn" autoFocus onClick={() => onClose(false)}>{cancelText}</button><button type="button" className="btn primary" onClick={() => onClose(true)}>{confirmText}</button></div>
 </dialog>;
}
export function confirmAction(title: string, text: string, confirmText: string, cancelText: string): Promise<boolean> {
 return new Promise(resolve => { const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); root.render(<ConfirmDialog title={title} text={text} confirmText={confirmText} cancelText={cancelText} onClose={accepted => { root.unmount(); host.remove(); resolve(accepted); }} />); });
}
