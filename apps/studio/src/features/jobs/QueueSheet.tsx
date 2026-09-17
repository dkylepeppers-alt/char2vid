import { useCallback, useEffect, useState } from 'react';

import type { JobView } from './job-sync';
import {
  cancelOnDeviceJob,
  hasOnDeviceProviderKey,
  listOnDeviceJobs,
} from './on-device-jobs';
import {
  cancelStudioJob,
  resolveStudioSession,
  syncStudioJobs,
} from './job-sync';

function costLabel(job: JobView): string {
  const cost = job.cost;
  if (!cost) {
    return 'cost unknown';
  }
  if (cost.state === 'final' && cost.amount !== undefined) {
    return `final ${cost.amount}`;
  }
  if (cost.state === 'estimate' && cost.durationSeconds !== undefined) {
    return `estimate ${cost.durationSeconds}s`;
  }
  if (cost.state === 'reservation' && cost.durationSeconds !== undefined) {
    return `reserved ${cost.durationSeconds}s`;
  }
  return cost.state;
}

export function QueueSheet() {
  const [jobs, setJobs] = useState<JobView[]>([]);
  const [status, setStatus] = useState('Checking the generation service…');
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (await hasOnDeviceProviderKey()) {
      try {
        const next = await listOnDeviceJobs();
        setJobs(next);
        setStatus(
          next.length === 0
            ? 'No jobs yet. Submit from Create; this phone keeps polling after you leave the screen.'
            : `${next.length} job${next.length === 1 ? '' : 's'} on this phone.`,
        );
      } catch {
        setStatus('Could not refresh on-device jobs.');
      }
      return;
    }
    const session = await resolveStudioSession();
    if (!session) {
      setJobs([]);
      setStatus(
        'Save a Nano-GPT API key in Settings to run jobs on this phone. A remote service is optional.',
      );
      return;
    }
    try {
      const next = await syncStudioJobs();
      setJobs(next);
      setStatus(
        next.length === 0
          ? 'No jobs yet. Submit an image from Create after attaching any library references.'
          : `${next.length} job${next.length === 1 ? '' : 's'} on the service.`,
      );
    } catch {
      setStatus('Could not refresh jobs from the generation service.');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return (
    <div className="queue-sheet">
      <p>{status}</p>
      {jobs.length > 0 ? (
        <ul className="job-list">
          {jobs.map((job) => (
            <li key={job.id} className="job-row">
              <p className="job-id">{job.clientRequestId}</p>
              <p className="job-meta">
                provider {job.providerState} · local {job.saveState} ·{' '}
                {costLabel(job)}
              </p>
              {job.errorCode ? (
                <p className="job-meta">error {job.errorCode}</p>
              ) : null}
              {job.originalJobId ? (
                <p className="job-meta">retry of {job.originalJobId}</p>
              ) : null}
              {job.providerState === 'queued' ? (
                <button
                  type="button"
                  className="secondary-action"
                  disabled={busyId === job.id}
                  onClick={() => {
                    setBusyId(job.id);
                    void (async () => {
                      if (await hasOnDeviceProviderKey()) {
                        await cancelOnDeviceJob(job.id);
                      } else {
                        const session = await resolveStudioSession();
                        if (!session) return;
                        await cancelStudioJob(session, job.id);
                      }
                      await refresh();
                    })().finally(() => setBusyId(null));
                  }}
                >
                  Cancel queued job
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
