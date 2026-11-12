import { useState } from 'react';
import { useT } from '../lib/i18n';
import { pushSupported, setPush, usePush } from '../lib/push';
export function PushSetting() {
  const T = useT(), enabled = usePush();
  const [busy, setBusy] = useState(false), [error, setError] = useState(false);
  return <>
    <label className="switch-row"><input type="checkbox" className="switch" checked={enabled === true} disabled={!pushSupported() || enabled == null || busy}
      onChange={async (e) => { const on = e.target.checked; setBusy(true); setError(false); try { await setPush(on, T.remindTitle, T.pushBody); } catch { setError(true); } finally { setBusy(false); } }} />{T.pushClosed}</label>
    {!pushSupported() && <p className="muted">{T.pushUnavailable}</p>}
    {error && <p role="alert">{T.pushError}</p>}
  </>;
}
