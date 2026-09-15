import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router';

import {
  destinationFromPath,
  resolveBack,
  resolveInitialPath,
  type Destination,
  type Sheet,
} from './navigation';
import { modalFocusTarget } from './modal-focus';
import { exitAndroidApp, listenForAndroidBack } from './platform';
import { LibraryPage } from '../features/library/LibraryPage';
import { CreatePage } from '../features/create/CreatePage';
import { BackupPage } from '../features/settings/BackupPage';
import { ServiceSettings } from '../features/settings/ServiceSettings';

const ROUTE_KEY = 'char2vid.selected-route';
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
    detail:
      'Pick a catalog model and inspect the request. Paid jobs come later.',
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
  const sheetElement = useRef<HTMLElement>(null);
  const sheetTrigger = useRef<HTMLElement | null>(null);

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

  const closeSheet = useCallback(() => setSheet(null), []);

  useEffect(() => {
    if (sheet !== null) {
      sheetElement.current
        ?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
        ?.focus();
      return;
    }
    sheetTrigger.current?.focus();
    sheetTrigger.current = null;
  }, [sheet]);

  const handleBack = useCallback(
    (canGoBack: boolean) => {
      const action = resolveBack(sheet, canGoBack);
      if (action === 'close-sheet') {
        closeSheet();
      } else if (action === 'navigate-back') {
        void navigate(-1);
      } else {
        void exitAndroidApp();
      }
    },
    [closeSheet, navigate, sheet],
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
      <header className="topbar" inert={sheet !== null}>
        <div>
          <p className="eyebrow">Local studio</p>
          <span className="brand">char2vid</span>
        </div>
        <div className="topbar-actions">
          <button
            className="status-chip"
            aria-label="Open jobs"
            onClick={(event) => {
              sheetTrigger.current = event.currentTarget;
              setSheet('jobs');
            }}
          >
            <span className="status-dot" aria-hidden="true" />
            <span className="wide-label">Open jobs</span>
            <span className="short-label">Jobs</span>
          </button>
          <button
            className="icon-button"
            aria-label="Open settings"
            onClick={(event) => {
              sheetTrigger.current = event.currentTarget;
              setSheet('settings');
            }}
          >
            <span aria-hidden="true">•••</span>
          </button>
        </div>
      </header>

      <div className="workspace" inert={sheet !== null}>
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

          {destination === 'library' ? (
            <LibraryPage />
          ) : destination === 'create' ? (
            <CreatePage />
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
        <div className="sheet-scrim" onPointerDown={closeSheet}>
          <section
            ref={sheetElement}
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sheet-title"
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key !== 'Tab') return;
              const focusable = Array.from(
                event.currentTarget.querySelectorAll<HTMLElement>(
                  FOCUSABLE_SELECTOR,
                ),
              );
              const target = modalFocusTarget(
                focusable,
                document.activeElement as HTMLElement | null,
                event.shiftKey,
              );
              if (target !== null) {
                event.preventDefault();
                target.focus();
              }
            }}
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
                onClick={closeSheet}
              >
                ×
              </button>
            </div>
            {sheet === 'jobs' ? (
              <p>
                Provider and local-save queues are not connected in this
                foundation.
              </p>
            ) : (
              <>
                <ServiceSettings />
                <BackupPage />
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
