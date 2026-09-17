import { useCallback, useEffect, useMemo, useState } from 'react';

import { serviceOnboardingChecklist } from '@char2vid/domain/debug-log';

import {
  logStudioError,
  studioDebugLog,
  useChecklistLog,
} from '../../app/debug-session';
import { resolvePlatform } from '../../app/platform';
import {
  nativeTokenForOrigin,
  normalizeServiceOrigin,
  SERVICE_ORIGIN_KEY,
  serviceOriginMessage,
} from './service-origin';

type Status =
  | { kind: 'idle' }
  | { kind: 'working'; message: string }
  | { kind: 'ok'; message: string }
  | { kind: 'error'; message: string };

interface SessionInfo {
  ownerId: string;
  deviceId: string;
  providerKey: { last4: string; fingerprint: string } | null;
}

function originFromInput(value: string): string {
  return normalizeServiceOrigin(value);
}

async function serviceFetch(
  origin: string,
  path: string,
  init: RequestInit,
  nativeToken?: string,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (nativeToken) {
    headers.set('Authorization', `Bearer ${nativeToken}`);
  }
  return fetch(`${origin}${path}`, {
    ...init,
    headers,
    credentials: nativeToken ? 'omit' : 'include',
  });
}

/**
 * Connects the studio to the personal generation service.
 * The Nano-GPT key is posted to the service over TLS and never stored in
 * `VITE_*`, localStorage, or this bundle.
 */
export function ServiceSettings() {
  const native = resolvePlatform() === 'android';
  const [origin, setOrigin] = useState(
    () => window.localStorage.getItem(SERVICE_ORIGIN_KEY) ?? '',
  );
  const [setupToken, setSetupToken] = useState('');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [nativeToken, setNativeToken] = useState<string | undefined>();
  const [tokenOrigin, setTokenOrigin] = useState<string | undefined>();
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  useEffect(() => {
    window.localStorage.setItem(SERVICE_ORIGIN_KEY, origin);
  }, [origin]);

  useEffect(() => {
    if (!native) {
      return;
    }
    void import('@char2vid/native-bridge/credentials').then(async (mod) => {
      const stored = await mod.loadNativeServiceSession();
      if (stored) {
        setOrigin(stored.serviceOrigin);
        setNativeToken(stored.deviceToken);
        setTokenOrigin(stored.serviceOrigin);
      }
    });
  }, [native]);

  const boundToken = nativeTokenForOrigin(nativeToken, tokenOrigin, origin);
  const onboarding = useMemo(
    () =>
      serviceOnboardingChecklist({
        originSet: origin.trim().length > 0,
        sessionReady: session !== null,
        providerKeyStored: session?.providerKey != null,
      }),
    [origin, session],
  );
  useChecklistLog('service-onboarding', onboarding, 'settings');

  const refreshSession = useCallback(
    async (token = boundToken) => {
      let base: string;
      try {
        base = originFromInput(origin);
      } catch {
        return;
      }
      const response = await serviceFetch(
        base,
        '/studio-api/session',
        { method: 'GET' },
        token,
      );
      if (!response.ok) {
        setSession(null);
        return;
      }
      setSession((await response.json()) as SessionInfo);
    },
    [boundToken, origin],
  );

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const onSetup = useCallback(async () => {
    setStatus({ kind: 'working', message: 'Completing service setup…' });
    try {
      const base = originFromInput(origin);
      const response = await serviceFetch(base, '/studio-api/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ setupToken, login, password }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? 'Setup failed');
      }
      setSetupToken('');
      studioDebugLog().info(
        'service.setup.ok',
        { host: new URL(base).host },
        { screen: 'settings', route: '/settings' },
      );
      setStatus({
        kind: 'ok',
        message:
          'Owner login created. Sign in to continue. HTTPS deploy is UNVERIFIED.',
      });
    } catch (error) {
      logStudioError(
        'service.setup.error',
        error,
        {},
        { screen: 'settings', route: '/settings' },
      );
      setStatus({
        kind: 'error',
        message: serviceOriginMessage(error, 'Setup failed'),
      });
    }
  }, [login, origin, password, setupToken]);

  const onLogin = useCallback(async () => {
    setStatus({ kind: 'working', message: 'Signing in…' });
    try {
      const base = originFromInput(origin);
      const response = await serviceFetch(base, '/studio-api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          login,
          password,
          client: native ? 'native' : 'browser',
        }),
      });
      const body = (await response.json()) as {
        error?: string;
        deviceToken?: string;
        deviceId?: string;
      };
      if (!response.ok) {
        throw new Error(body.error ?? 'Sign-in failed');
      }
      let token = boundToken;
      if (native && body.deviceToken && body.deviceId) {
        const { saveNativeServiceSession } =
          await import('@char2vid/native-bridge/credentials');
        await saveNativeServiceSession({
          deviceToken: body.deviceToken,
          deviceId: body.deviceId,
          serviceOrigin: base,
        });
        token = body.deviceToken;
        setNativeToken(body.deviceToken);
        setTokenOrigin(base);
      }
      setPassword('');
      await refreshSession(token);
      studioDebugLog().info(
        'service.session.ok',
        { host: new URL(base).host, native },
        { screen: 'settings', route: '/settings' },
      );
      setStatus({
        kind: 'ok',
        message: native
          ? 'Session stored in Keystore (device proof UNVERIFIED).'
          : 'Browser session cookie set.',
      });
    } catch (error) {
      logStudioError(
        'service.session.error',
        error,
        {},
        { screen: 'settings', route: '/settings' },
      );
      setStatus({
        kind: 'error',
        message: serviceOriginMessage(error, 'Sign-in failed'),
      });
    }
  }, [boundToken, login, native, origin, password, refreshSession]);

  const onSaveKey = useCallback(async () => {
    setStatus({
      kind: 'working',
      message: 'Submitting provider key to the service…',
    });
    try {
      const base = originFromInput(origin);
      const response = await serviceFetch(
        base,
        '/studio-api/provider-key',
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ apiKey }),
        },
        boundToken,
      );
      const body = (await response.json()) as {
        error?: string;
        last4?: string;
        fingerprint?: string;
      };
      if (!response.ok) {
        throw new Error(body.error ?? 'Provider key was not accepted');
      }
      setApiKey('');
      await refreshSession();
      studioDebugLog().info(
        'service.provider-key.ok',
        { last4: body.last4 ?? null },
        { screen: 'settings', route: '/settings' },
      );
      setStatus({
        kind: 'ok',
        message: `Key stored on the service (…${body.last4 ?? ''}). Live check-balance validation is UNVERIFIED in this environment.`,
      });
    } catch (error) {
      logStudioError(
        'service.provider-key.error',
        error,
        {},
        { screen: 'settings', route: '/settings' },
      );
      setStatus({
        kind: 'error',
        message: serviceOriginMessage(error, 'Provider key failed'),
      });
    }
  }, [apiKey, boundToken, origin, refreshSession]);

  const onRevoke = useCallback(async () => {
    setStatus({ kind: 'working', message: 'Revoking this device session…' });
    try {
      const base = originFromInput(origin);
      const response = await serviceFetch(
        base,
        '/studio-api/session',
        { method: 'DELETE' },
        boundToken,
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? 'Revoke failed');
      }
      if (native) {
        const { clearNativeServiceSession } =
          await import('@char2vid/native-bridge/credentials');
        await clearNativeServiceSession();
      }
      setNativeToken(undefined);
      setTokenOrigin(undefined);
      setSession(null);
      studioDebugLog().info(
        'service.session.revoked',
        { native },
        { screen: 'settings', route: '/settings' },
      );
      setStatus({
        kind: 'ok',
        message: 'Session revoked. Offline library is unchanged.',
      });
    } catch (error) {
      logStudioError(
        'service.session.revoke-error',
        error,
        {},
        { screen: 'settings', route: '/settings' },
      );
      setStatus({
        kind: 'error',
        message: serviceOriginMessage(error, 'Revoke failed'),
      });
    }
  }, [boundToken, native, origin]);

  return (
    <section className="backup-panel" aria-labelledby="service-title">
      <div>
        <p className="section-kicker">Generation service</p>
        <h3 id="service-title">Service connection</h3>
        <p>
          The personal service holds the Nano-GPT key and temporary media. This
          app only keeps a session cookie or a Keystore-backed device token.
        </p>
      </div>

      <label htmlFor="service-origin">Service origin</label>
      <input
        id="service-origin"
        type="url"
        autoComplete="url"
        placeholder="https://studio.example"
        value={origin}
        onChange={(event) => setOrigin(event.target.value)}
      />

      <label htmlFor="service-setup-token">One-time setup token</label>
      <input
        id="service-setup-token"
        type="password"
        autoComplete="off"
        value={setupToken}
        onChange={(event) => setSetupToken(event.target.value)}
      />

      <label htmlFor="service-login">Owner login</label>
      <input
        id="service-login"
        autoComplete="username"
        value={login}
        onChange={(event) => setLogin(event.target.value)}
      />

      <label htmlFor="service-password">Owner password</label>
      <input
        id="service-password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />

      <div className="backup-actions">
        <button
          type="button"
          className="secondary-action"
          onClick={() => void onSetup()}
          disabled={status.kind === 'working'}
        >
          Complete setup
        </button>
        <button
          type="button"
          className="primary-action"
          onClick={() => void onLogin()}
          disabled={status.kind === 'working'}
        >
          Sign in
        </button>
      </div>

      <label htmlFor="service-api-key">Nano-GPT API key</label>
      <input
        id="service-api-key"
        type="password"
        autoComplete="off"
        value={apiKey}
        onChange={(event) => setApiKey(event.target.value)}
      />
      <div className="backup-actions">
        <button
          type="button"
          className="primary-action"
          onClick={() => void onSaveKey()}
          disabled={status.kind === 'working'}
        >
          Store key on service
        </button>
        <button
          type="button"
          className="secondary-action"
          onClick={() => void onRevoke()}
          disabled={status.kind === 'working'}
        >
          Revoke this device
        </button>
      </div>

      {session?.providerKey ? (
        <p className="backup-status" role="status">
          Key on service: …{session.providerKey.last4} (
          {session.providerKey.fingerprint})
        </p>
      ) : null}

      {status.kind !== 'idle' && (
        <p
          className={
            status.kind === 'error'
              ? 'backup-status backup-status-error'
              : 'backup-status'
          }
          role="status"
        >
          {status.message}
        </p>
      )}
    </section>
  );
}
