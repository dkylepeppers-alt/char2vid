import { useEffect, useState } from 'react';

import { formatStudioDebugLine } from './debug-log';
import { getStudioDebugSession } from './debug-session';

export function DebugLogPanel() {
  const session = getStudioDebugSession();
  const [enabled, setEnabled] = useState(() => session.enabled());
  const [lines, setLines] = useState(() =>
    session.ring.snapshot().map(formatStudioDebugLine).reverse(),
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      setLines(session.ring.snapshot().map(formatStudioDebugLine).reverse());
      setEnabled(session.enabled());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [session]);

  return (
    <section className="backup-panel" aria-labelledby="debug-log-title">
      <div>
        <p className="section-kicker">Diagnostics</p>
        <h3 id="debug-log-title">Debug logs</h3>
        <p>
          High-signal studio events for this device. Console and Android logcat
          receive the same sanitized lines. Prompt text, keys, cookies, and
          signed URLs are never written.
        </p>
      </div>
      <label className="mode-toggle">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => {
            session.setEnabled(event.target.checked);
            setEnabled(event.target.checked);
          }}
        />
        Write debug logs to console / logcat
      </label>
      <ol className="debug-log-list" aria-label="Recent debug logs">
        {lines.length === 0 ? (
          <li>No debug events yet.</li>
        ) : (
          lines.map((line, index) => (
            <li key={`${index}-${line.slice(0, 24)}`}>
              <code>{line}</code>
            </li>
          ))
        )}
      </ol>
    </section>
  );
}
