import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { BuildPlan, JobProgress, UiMode, WindowsBuildConfig } from '@shared/types.js';
import type { ValidationIssue } from '@shared/windows/validate.js';
import { linuxImages } from '@shared/linux/catalog.js';
import { ApiError, buildPlan, loadCatalog, type Catalog } from './api.ts';
import { updateConfig } from './config.ts';
import { AdvancedTab } from './components/AdvancedTab.tsx';
import { AgentPanel, type AgentState } from './components/AgentPanel.tsx';
import { EasyTab } from './components/EasyTab.tsx';
import { SetupDetails } from './components/SetupDetails.tsx';
import { formatBytes } from '@shared/format.js';
import { PlanSummary, ProgressPanel } from './components/ProgressPanel.tsx';
import { Banner, Button, Card, Field, Select, TextInput, Toggle } from './components/ui.tsx';

const EMPTY_AGENT: AgentState = { client: null, info: null, devices: [] };

export function App() {
  const compact = location.hostname === '127.0.0.1' && location.hash === '#desktop';
  const [catalog] = useState<Catalog>(() => loadCatalog());
  const [mode, setMode] = useState<UiMode>('easy');
  const [config, setConfig] = useState<WindowsBuildConfig>(() => loadCatalog().defaults.easy);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [windowsPlan, setPlan] = useState<BuildPlan | null>(null);
  const [family, setFamily] = useState<'windows' | 'linux'>('windows');
  const [imageId, setImageId] = useState('ubuntu-desktop');
  const [agent, setAgent] = useState<AgentState>(EMPTY_AGENT);
  const [wantPersistence, setPersistent] = useState(false);
  const canPersist = agent.info?.capabilities.ubuntuPersistence === true && imageId === 'ubuntu-desktop';
  const persistent = canPersist && wantPersistence;
  const [localPath, setLocalPath] = useState('');
  const image = linuxImages.find((entry) => entry.id === imageId)!;
  const linux = family === 'linux';
  const plan: BuildPlan | null = linux ? {
    injectedFiles: [], removedPaths: [], warnings: [],
    summary: [`Verify ${image.fileName} against its published SHA-256 before erasing the USB.`,
      persistent ? 'Add 1 GiB of unencrypted storage for the Ubuntu live session.' : 'Write the official image unchanged and verify it by reading back the USB.'],
    bootSteps: ['Use the target x86-64 PC’s one-time boot menu and choose the USB.',
      image.live ? `Choose the live or try option to run ${image.name} without installing. Start its installer only if you want to change the PC’s disk.` : `Follow the ${image.name} installer. This image is not a live desktop.`,
      ...(image.live ? [persistent ? 'Save a file in your home folder, restart from the stick, and check it is still there.' : 'Live-session changes are lost on restart.'] : [])],
  } : windowsPlan;

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
  const blocking = linux ? [] : issues.filter((issue) => issue.severity === 'error');
  // Without elevation the build always dies at the partition step, so do not
  // let it start and waste an 8 GB download first.
  const elevated = agent.info?.elevated !== false;
  const readyToCreate = Boolean(plan && agent.client && selectedDevice && !selectedDevice.isSystem && elevated && !starting && blocking.length === 0
    && (!(requireRemovable || linux) || selectedDevice.removable)
    && (!linux || (agent.info?.capabilities.linuxImaging && ['usb', 'sd'].includes(selectedDevice.bus))));

  useEffect(() => { setConfirming(false); setStartError(null); }, [family, imageId, localPath, persistent, deviceId, requireRemovable, agent]);

  const start = useCallback(async () => {
    if (!readyToCreate || !plan || !agent.client || !selectedDevice) return;
    setStarting(true);
    setStartError(null);
    try {
      const language = catalog.languages.find((entry) => entry.tag === config.image.language);
      const iso = linux ? null : await agent.client.resolveIso(config.image.arch, config.image.language, language?.microsoftName ?? 'English');
      const created = await agent.client.createJob(!iso ? {
        family, imageId, persistent, deviceId: selectedDevice.id, targetName: selectedDevice.description,
        targetBytes: selectedDevice.sizeBytes, keepIso, ...(localPath.trim() ? { localPath: localPath.trim() } : {}),
      } : {
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
  }, [agent.client, catalog, config, keepIso, plan, requireRemovable, selectedDevice, linux, family, imageId, persistent, localPath, readyToCreate]);

  return (
    <main className={`shell${compact ? ' workstation' : ''}`}>
      <header className="header">
        <img src="./icon.svg" alt="" width="48" height="48" />
        <h1>{compact ? 'OS Installation Tool' : 'Windows and Linux bootable USBs'}</h1>
        {!compact && <>
        <p>
          Build a Windows installer, try a live Linux desktop, or install Linux.
        </p>
        {!linux && <div className="pills">
          <span className="pill">
            <strong>Official</strong> ISO from Microsoft
          </span>
          <span className="pill">
            <strong>No</strong> Microsoft account
          </span>
          <span className="pill">
            <strong>Nothing</strong> left on your machine
          </span>
        </div>}
        </>}
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
          <fieldset disabled={starting} style={{ border: 0, padding: 0, margin: 0 }}>
          <Card title="Operating system">
            <Field label="USB image family"><Select value={family} onChange={setFamily}
              options={[{ value: 'windows', label: 'Windows 11' }, { value: 'linux', label: 'Linux (x86-64)' }]} /></Field>
          </Card>
          {linux ? <Card title="Linux image" subtitle="Choose your settings first. After you confirm Create USB, the helper downloads the image on this computer and verifies it before erasing the stick.">
            <Field label="Distribution"><Select value={imageId} onChange={(id) => { setImageId(id); setPersistent(false); setLocalPath(''); }}
              options={linuxImages.map((i) => ({ value: i.id, label: `${i.name} — ${i.live ? 'live or install' : 'installer'}` }))} /></Field>
            <SetupDetails compact={compact} title="ISO options">
            <p><a href={image.checksumUrl} target="_blank" rel="noreferrer">Official checksums</a> for {image.fileName}</p>
            <Field label="Already downloaded? Full ISO path (optional)" hint="Leave empty to download from the distribution. A local copy must match the selected release.">
              <TextInput value={localPath} onChange={setLocalPath} />
            </Field>
            {canPersist && <Toggle checked={persistent} onChange={setPersistent} label="Keep live-session changes"
              description="Add a 1 GiB writable partition. Requires xorriso and e2fsprogs on the helper host, plus space for a second image." />}
            </SetupDetails>
          </Card> : <>
          {compact && <Card title="Windows setup">
            <Field label="Local user name"><TextInput value={config.account.username} maxLength={20}
              onChange={(username) => update(draft => { draft.account.username = username; })} /></Field>
            <p className="muted">{config.image.language} · {config.image.arch}</p>
          </Card>}
          <div className={compact ? 'options-row' : undefined}>
          <SetupDetails compact={compact} title="Windows settings">
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
          </SetupDetails>
          </div>
          </>}

          <AgentPanel
            state={agent}
            onConnected={setAgent}
            selectedDeviceId={deviceId}
            onSelectDevice={setDeviceId}
            removableOnly={linux}
            requireRemovable={linux || requireRemovable}
            onRequireRemovableChange={setRequireRemovable}
            keepIso={keepIso}
            onKeepIsoChange={setKeepIso}
          />
          </fieldset>
          {linux && agent.info && !agent.info.capabilities.linuxImaging && <Banner tone="warning">Run the updated local helper for Linux image support.</Banner>}

          {plan ? <SetupDetails compact={compact} title="Review build plan"><PlanSummary plan={plan} device={selectedDevice} /></SetupDetails> : null}

          <Card>
            {compact && blocking.length > 0 && <p className="muted" role="status">{blocking[0]?.message}</p>}
            {!compact && blocking.length > 0 ? (
              <Banner tone="warning" title="Nearly there">
                <ul className="summary">
                  {blocking.map((issue) => (
                    <li key={`${issue.field}-${issue.message}`}>{issue.message}</li>
                  ))}
                </ul>
              </Banner>
            ) : null}
            {!agent.client ? <p className="muted">Connect the helper above to pick a USB stick.</p> : null}
            {agent.client && elevated && !selectedDevice ? <p className="muted">Select the USB stick you want to erase.</p> : null}
            {agent.client && !elevated ? (
              <Banner tone="danger" title="The helper needs administrator rights">
                {compact ? 'Close the app and choose “Run as administrator” to enable writing.' :
                  'Restart the helper as Administrator on Windows or with sudo on macOS and Linux, then reconnect.'}
              </Banner>
            ) : null}
            {startError ? <Banner tone="danger">{startError}</Banner> : null}

            {confirming ? (
              <Banner tone="danger" title={`Erase ${selectedDevice ? `${selectedDevice.description} (${formatBytes(selectedDevice.sizeBytes)}, ${selectedDevice.id})` : 'the selected drive'}?`}>
                <p>Everything on it is destroyed. This cannot be undone.</p>
                {compact && !linux && config.setup.disk.kind === 'wipe-disk' &&
                  <p>Windows Setup will also erase disk {config.setup.disk.diskId} on the installation PC without another prompt.</p>}
                <div className="row">
                  <Button variant="danger" onClick={() => void start()} disabled={!readyToCreate}>
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

      {!compact && <footer className="footer">
        <p>
          Windows is downloaded directly from Microsoft each time. This tool never mirrors, repackages or redistributes their
          media, and it does not activate Windows. The download is deleted from your computer when the job ends.
        </p>
        <div className="footer__links">
          <a href="https://github.com/bsantacruzms/os-installation-tool" target="_blank" rel="noreferrer noopener">
            Source on GitHub
          </a>
          <a
            href="https://github.com/bsantacruzms/os-installation-tool#why-this-cannot-be-a-pure-web-page"
            target="_blank"
            rel="noreferrer noopener"
          >
            Why a helper is needed
          </a>
          <a href="https://github.com/bsantacruzms/os-installation-tool/issues" target="_blank" rel="noreferrer noopener">
            Report a problem
          </a>
        </div>
      </footer>}
    </main>
  );
}
