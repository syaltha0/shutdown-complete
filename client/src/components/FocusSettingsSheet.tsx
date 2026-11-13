import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useDoc } from '../lib/useDoc';
import { defaultSettings, type Settings } from '../lib/model';
import { SaveStamp } from './Common';
import { FocusConfig } from './FocusConfig';
import { useT } from '../lib/i18n';
export function FocusSettingsSheet({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const T = useT();
  const { status } = useDoc<Settings>('settings', () => defaultSettings());
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => previous?.focus();
  }, []);
  return createPortal(<dialog ref={dialog} className="sheet focus-settings-sheet" aria-labelledby="focus-settings-heading" onCancel={onClose} onClose={onClose} onClick={e => { if (e.target === dialog.current) onClose(); }}>
    <header><div><h2 id="focus-settings-heading">{T.focusSettings}</h2><SaveStamp status={status} /></div><button type="button" className="btn ghost" onClick={onClose}>{T.close}</button></header>
    <FocusConfig />
  </dialog>, document.body);
}

