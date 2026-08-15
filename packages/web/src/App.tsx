import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { BuildPlan, JobProgress, UiMode, WindowsBuildConfig } from '@shared/types.js';
import type { ValidationIssue } from '@shared/windows/validate.js';
import { ApiError, buildPlan, loadCatalog, type Catalog } from './api.ts';
import { updateConfig } from './config.ts';
import { AdvancedTab } from './components/AdvancedTab.tsx';
import { AgentPanel, type AgentState } from './components/AgentPanel.tsx';
import { EasyTab } from './components/EasyTab.tsx';
import { PlanSummary, ProgressPanel } from './components/ProgressPanel.tsx';
import { Banner, Button, Card } from './components/ui.tsx';

const EMPTY_AGENT: AgentState = { client: null, info: null, devices: [] };

export function App() {
  const [catalog] = useState<Catalog>(() => loadCatalog());
  const [mode, setMode] = useState<UiMode>('easy');
  const [config, setConfig] = useState<WindowsBuildConfig>(() => loadCatalog().defaults.easy);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [plan, setPlan] = useState<BuildPlan | null>(null);

  const [agent, setAgent] = useState<AgentState>(EMPTY_AGENT);
  const [deviceId, setDeviceId] = useState('');
  const [requireRemovable, setRequireRemovable] = useState(true);
  const [keepIso, setKeepIso] = useState(false);

  const [confirming, setConfirming] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const unsubscribe = useRef<(() => void) | null>(null);

  useEffect(() => {
    const result = buildPlan(config);
    setIssues(result.issues);
    setPlan(result.plan);
  }, [config]);

  useEffect(() => () => unsubscribe.current?.(), []);

  const update = useCallback(
    (mutate: (draft: WindowsBuildConfig) => void) => setConfig((current) => updateConfig(current, mutate)),
    [],
  );

  const selectedDevice = useMemo(() => agent.devices.find((device) => device.id === deviceId), [agent.devices, deviceId]);
  const blocking = issues.filter((issue) => issue.severity === 'error');
  const readyToCreate = Boolean(config && plan && agent.client && selectedDevice && blocking.length === 0);

  const start = useCallback(async () => {
    if (!config || !plan || !agent.client || !selectedDevice) return;
    setStarting(true);
    setStartError(null);
    try {
      const language = catalog.languages.find((entry) => entry.tag === config.image.language);
      const iso = await agent.client.resolveIso(config.image.arch, config.image.language, language?.microsoftName ?? 'English');

      const created = await agent.client.createJob({
        deviceId: selectedDevice.id,
        iso: { kind: 'url', url: iso.url, fileName: iso.fileName },
        plan,
        volumeLabel: 'WIN11',
        requireRemovable,
        keepIso,
      });

      setProgress(created.progress);
      setLog([]);
      setConfirming(false);
      unsubscribe.current?.();
      unsubscribe.current = agent.client.subscribe(
        (next) => setProgress((current) => (current && next.jobId !== current.jobId ? current : next)),
        (message) => setLog((current) => [...current.slice(-500), message]),
      );
    } catch (error) {
      const message =
        error instanceof ApiError
          ? [error.message, error.hint].filter(Boolean).join(' ')
          : 'Something went wrong before writing started.';
      setStartError(message);
    } finally {
      setStarting(false);
    }
  }, [agent.client, catalog, config, keepIso, plan, requireRemovable, selectedDevice]);

  return (
    <main className="shell">
      <header className="header">
        <h1>OS Installation Tool</h1>
        <p>
          Build a bootable Windows 11 USB stick from Windows, macOS or Linux, with the account, the privacy settings and every
          setup answer already filled in.
        </p>
      </header>

      {progress ? (
        <ProgressPanel
          progress={progress}
          log={log}
          bootSteps={plan?.bootSteps ?? []}
          onCancel={() => {
            if (agent.client) void agent.client.cancel(progress.jobId);
          }}
          onReset={() => {
            unsubscribe.current?.();
            unsubscribe.current = null;
            setProgress(null);
            setLog([]);
          }}
        />
      ) : (
        <>
          <div className="tabs" role="tablist">
            <button
              role="tab"
              aria-selected={mode === 'easy'}
              className={mode === 'easy' ? 'tab tab--active' : 'tab'}
              onClick={() => setMode('easy')}
            >
              Easy
              <span>Sensible defaults, four questions</span>
            </button>
            <button
              role="tab"
              aria-selected={mode === 'advanced'}
              className={mode === 'advanced' ? 'tab tab--active' : 'tab'}
              onClick={() => setMode('advanced')}
            >
              Advanced
              <span>Every knob, including the sharp ones</span>
            </button>
          </div>

          {mode === 'easy' ? (
            <EasyTab config={config} update={update} catalog={catalog} issues={issues} />
          ) : (
            <AdvancedTab config={config} update={update} catalog={catalog} issues={issues} />
          )}

          <AgentPanel
            state={agent}
            onConnected={setAgent}
            selectedDeviceId={deviceId}
            onSelectDevice={setDeviceId}
            requireRemovable={requireRemovable}
            onRequireRemovableChange={setRequireRemovable}
            keepIso={keepIso}
            onKeepIsoChange={setKeepIso}
          />

          {plan ? <PlanSummary plan={plan} device={selectedDevice} /> : null}

          <Card>
            {blocking.length > 0 ? (
              <Banner tone="warning" title="Nearly there">
                <ul className="summary">
                  {blocking.map((issue) => (
                    <li key={`${issue.field}-${issue.message}`}>{issue.message}</li>
                  ))}
                </ul>
              </Banner>
            ) : null}
            {!agent.client ? <p className="muted">Connect the helper above to pick a USB stick.</p> : null}
            {agent.client && !selectedDevice ? <p className="muted">Select the USB stick you want to erase.</p> : null}
            {startError ? <Banner tone="danger">{startError}</Banner> : null}

            {confirming ? (
              <Banner tone="danger" title={`Erase ${selectedDevice?.description ?? 'the selected drive'}?`}>
                <p>Everything on it is destroyed. This cannot be undone.</p>
                <div className="row">
                  <Button variant="danger" onClick={() => void start()} disabled={starting}>
                    {starting ? 'Starting...' : 'Yes, erase it and build the installer'}
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirming(false)} disabled={starting}>
                    Cancel
                  </Button>
                </div>
              </Banner>
            ) : (
              <Button variant="primary" disabled={!readyToCreate} onClick={() => setConfirming(true)}>
                Create the USB stick
              </Button>
            )}
          </Card>
        </>
      )}

      <footer className="footer">
        <p>
          Windows is downloaded directly from Microsoft each time. This tool never mirrors, repackages or redistributes their
          media, and it does not activate Windows.
        </p>
      </footer>
    </main>
  );
}
