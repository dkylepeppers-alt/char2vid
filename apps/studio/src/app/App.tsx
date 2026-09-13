import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router';

import {
  destinationFromPath,
  resolveBack,
  resolveInitialPath,
  type Destination,
  type Sheet,
} from './navigation';
import { exitAndroidApp, listenForAndroidBack } from './platform';

const ROUTE_KEY = 'char2vid.selected-route';
const DRAFT_KEY = 'char2vid.create-draft';

const destinationLabels: Record<Destination, string> = {
  library: 'Library',
  characters: 'Characters',
  create: 'Create',
  projects: 'Projects',
};

const emptyStates: Record<Destination, { title: string; detail: string }> = {
  library: {
    title: 'Your media stays on this device',
    detail: 'Import and organized storage arrive in the next milestone.',
  },
  characters: {
    title: 'No characters yet',
    detail: 'Character references and revision tools are not available yet.',
  },
  create: {
    title: 'Shape your next shot',
    detail: 'Drafting is available. Model selection and generation come later.',
  },
  projects: {
    title: 'No projects yet',
    detail:
      'Project, shot, and timeline tools are planned for later milestones.',
  },
};

export function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [draft, setDraft] = useState(
    () => window.localStorage.getItem(DRAFT_KEY) ?? '',
  );

  const selectedPath = resolveInitialPath(
    location.pathname,
    window.localStorage.getItem(ROUTE_KEY),
  );
  const destination = destinationFromPath(selectedPath) ?? 'library';
  const current = useMemo(() => emptyStates[destination], [destination]);

  useEffect(() => {
    if (location.pathname !== selectedPath) {
      void navigate(selectedPath, { replace: true });
    }
  }, [location.pathname, navigate, selectedPath]);

  useEffect(() => {
    window.localStorage.setItem(ROUTE_KEY, destination);
  }, [destination]);

  const handleBack = useCallback(
    (canGoBack: boolean) => {
      const action = resolveBack(sheet, canGoBack);
      if (action === 'close-sheet') {
        setSheet(null);
      } else if (action === 'navigate-back') {
        void navigate(-1);
      } else {
        void exitAndroidApp();
      }
    },
    [navigate, sheet],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && sheet !== null) {
        event.preventDefault();
        handleBack(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleBack, sheet]);

  useEffect(() => {
    let disposed = false;
    let handle: Awaited<ReturnType<typeof listenForAndroidBack>>;
    void listenForAndroidBack(handleBack).then((registeredHandle) => {
      if (disposed) {
        void registeredHandle?.remove();
      } else {
        handle = registeredHandle;
      }
    });
    return () => {
      disposed = true;
      void handle?.remove();
    };
  }, [handleBack]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Local studio</p>
          <span className="brand">char2vid</span>
        </div>
        <div className="topbar-actions">
          <button
            className="status-chip"
            aria-label="Open jobs"
            onClick={() => setSheet('jobs')}
          >
            <span className="status-dot" aria-hidden="true" />
            <span className="wide-label">Open jobs</span>
            <span className="short-label">Jobs</span>
          </button>
          <button
            className="icon-button"
            aria-label="Open settings"
            onClick={() => setSheet('settings')}
          >
            <span aria-hidden="true">•••</span>
          </button>
        </div>
      </header>

      <div className="workspace">
        <nav className="navigation" aria-label="Studio destinations">
          {(Object.keys(destinationLabels) as Destination[]).map((target) => (
            <NavLink
              key={target}
              to={`/${target}`}
              onClick={() => setSheet(null)}
            >
              <span className="nav-mark" aria-hidden="true" />
              {destinationLabels[target]}
            </NavLink>
          ))}
        </nav>

        <main className="content" tabIndex={-1}>
          <div className="page-heading">
            <p className="eyebrow">Workspace</p>
            <h1>{destinationLabels[destination]}</h1>
          </div>

          {destination === 'create' ? (
            <section className="draft-card" aria-labelledby="draft-title">
              <div>
                <p className="section-kicker">Draft</p>
                <h2 id="draft-title">{current.title}</h2>
                <p>{current.detail}</p>
              </div>
              <label htmlFor="prompt">Prompt</label>
              <textarea
                id="prompt"
                value={draft}
                placeholder="Describe the image or scene you want to make…"
                onChange={(event) => {
                  const value = event.target.value;
                  setDraft(value);
                  window.localStorage.setItem(DRAFT_KEY, value);
                }}
              />
              <button className="primary-action" disabled>
                Generation unavailable
              </button>
            </section>
          ) : (
            <section className="empty-card">
              <div className="empty-art" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <div>
                <p className="section-kicker">Foundation</p>
                <h2>{current.title}</h2>
                <p>{current.detail}</p>
              </div>
            </section>
          )}
        </main>
      </div>

      {sheet !== null && (
        <div className="sheet-scrim" onPointerDown={() => setSheet(null)}>
          <section
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sheet-title"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="sheet-handle" aria-hidden="true" />
            <div className="sheet-heading">
              <div>
                <p className="section-kicker">Studio</p>
                <h2 id="sheet-title">
                  {sheet === 'jobs' ? 'Jobs' : 'Settings'}
                </h2>
              </div>
              <button
                className="icon-button"
                aria-label="Close"
                onClick={() => setSheet(null)}
              >
                ×
              </button>
            </div>
            <p>
              {sheet === 'jobs'
                ? 'Provider and local-save queues are not connected in this foundation.'
                : 'App preferences will appear here as features are added.'}
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
