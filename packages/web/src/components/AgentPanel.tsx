import { useCallback, useEffect, useState } from 'react';

import type { UsbDevice } from '@shared/types.js';
import { formatBytes } from '@shared/format.js';
import { AgentClient, ApiError, guessAgentUrl, type AgentInfoResponse } from '../api.ts';
import { Banner, Button, Card, Details, Field, TextInput, Toggle } from './ui.tsx';

export interface AgentState {
  client: AgentClient | null;
  info: AgentInfoResponse | null;
  devices: UsbDevice[];
}

const REPO = 'bsantacruzms/os-installation-tool';
const RELEASE = `https://github.com/${REPO}/releases/latest/download`;

interface HelperDownload {
  id: string;
  label: string;
  hint: string;
  url: string;
  /** Suffix of the released file name this entry corresponds to. */
  asset: string;
}

const HELPER_DOWNLOADS: HelperDownload[] = [
  { id: 'windows', label: 'Windows', hint: 'osit-agent.exe', asset: 'osit-agent-windows-x64.exe', url: `${RELEASE}/osit-agent-windows-x64.exe` },
  { id: 'macos', label: 'macOS', hint: 'Apple silicon', asset: 'osit-agent-macos-arm64', url: `${RELEASE}/osit-agent-macos-arm64` },
  { id: 'macos-intel', label: 'macOS', hint: 'Intel', asset: 'osit-agent-macos-x64', url: `${RELEASE}/osit-agent-macos-x64` },
  { id: 'linux', label: 'Linux', hint: 'x64', asset: 'osit-agent-linux-x64', url: `${RELEASE}/osit-agent-linux-x64` },
];

/** Best guess so the right download is highlighted first. */
function detectPlatform(): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (/Win/i.test(ua)) return 'windows';
  if (/Mac/i.test(ua)) return /Intel/i.test(ua) && !/ARM|Apple/i.test(ua) ? 'macos-intel' : 'macos';
  if (/Linux|X11/i.test(ua)) return 'linux';
  return 'windows';
}

/**
 * Asks GitHub which binaries actually exist, so a platform whose runner was
 * unavailable is hidden rather than offered as a dead link.
 */
function useAvailableDownloads(desktop: boolean): HelperDownload[] {
  const [available, setAvailable] = useState<HelperDownload[] | null>(null);

  useEffect(() => {
    if (desktop) return;
    let cancelled = false;
    fetch(`https://api.github.com/repos/${REPO}/releases/latest`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('no release'))))
      .then((release: { assets?: Array<{ name: string }> }) => {
        const names = new Set((release.assets ?? []).map((a) => a.name));
        if (!cancelled && names.size > 0) {
          setAvailable(HELPER_DOWNLOADS.filter((d) => names.has(d.asset)));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [desktop]);

  // Before the answer arrives, show everything rather than an empty panel.
  return available ?? HELPER_DOWNLOADS;
}

export function AgentPanel({
  state,
  onConnected,
  selectedDeviceId,
  onSelectDevice,
  requireRemovable,
  onRequireRemovableChange,
  keepIso,
  onKeepIsoChange,
  removableOnly = false,
}: {
  state: AgentState;
  onConnected: (next: AgentState) => void;
  selectedDeviceId: string;
  onSelectDevice: (id: string) => void;
  requireRemovable: boolean;
  onRequireRemovableChange: (value: boolean) => void;
  keepIso: boolean;
  onKeepIsoChange: (value: boolean) => void;
  removableOnly?: boolean;
}) {
  const desktop = location.hostname === '127.0.0.1' && location.hash === '#desktop';
  const [baseUrl, setBaseUrl] = useState(() => desktop ? location.origin : guessAgentUrl());
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<'idle' | 'checking' | 'found' | 'missing'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const detectedPlatform = detectPlatform();
  const downloads = useAvailableDownloads(desktop);

  useEffect(() => {
    if (desktop) return;
    let cancelled = false;
    setStatus('checking');
    // The helper may be started while this page is open, so keep looking.
    const probe = () => {
      AgentClient.ping(baseUrl.replace(/\/$/, ''))
        .then(() => !cancelled && setStatus('found'))
        .catch(() => !cancelled && setStatus('missing'));
    };
    probe();
    const timer = setInterval(probe, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [baseUrl, desktop]);

  const connect = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const client = new AgentClient(baseUrl.replace(/\/$/, ''), code);
      const [info, devices] = await Promise.all([client.info(), client.devices()]);
      onConnected({ client, info, devices });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not reach the helper. Is it running?');
    } finally {
      setBusy(false);
    }
  }, [baseUrl, code, onConnected]);

  useEffect(() => {
    if (desktop && !state.client) void connect();
  }, [desktop, state.client, connect]);

  const refreshDevices = useCallback(async () => {
    if (!state.client) return;
    setBusy(true);
    try {
      onConnected({ ...state, devices: await state.client.devices() });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not read the drive list.');
    } finally {
      setBusy(false);
    }
  }, [onConnected, state]);

  if (!state.client) {
    if (desktop) return <Card title="USB drive">
      {error ? <><Banner tone="danger">{error}</Banner><Button onClick={() => void connect()} disabled={busy}>Retry</Button></> :
        <p>Checking this computer for USB drives...</p>}
    </Card>;
    return (
      <Card
        title="Connect this computer"
        subtitle="A browser cannot format a USB stick on its own. A small helper runs on your machine and does the privileged work; this page just tells it what to build."
      >
        {status === 'missing' ? (
          <Banner tone="info" title="Helper not running">
            <p>Download it once. One file, nothing to install, no account.</p>
            <div className="downloads">
              {downloads.map((item) => (
                <a
                  key={item.id}
                  className={`download ${item.id === detectedPlatform ? 'download--suggested' : ''}`}
                  href={item.url}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <strong>{item.label}</strong>
                  <span>{item.hint}</span>
                </a>
              ))}
            </div>
            <p className="muted">
              Run it, then type the pairing code it prints below. It needs administrator rights on Windows, or{' '}
              <code>sudo</code> on macOS and Linux, because formatting a drive does.{' '}
              <a href={`https://github.com/${REPO}/releases/latest`} target="_blank" rel="noreferrer noopener">
                All downloads and checksums
              </a>
              .
            </p>
          </Banner>
        ) : null}
        {status === 'found' ? <Banner tone="success">A helper is running. Enter the pairing code it printed.</Banner> : null}

        <Field label="Pairing code" hint="Shown in the helper's window, for example ABCD-EFGH-JKLM.">
          <TextInput value={code} onChange={setCode} placeholder="ABCD-EFGH-JKLM" />
        </Field>

        <Details summary="Helper is on a different address">
          <Field label="Helper address">
            <TextInput value={baseUrl} onChange={setBaseUrl} placeholder="http://127.0.0.1:5179" />
          </Field>
        </Details>

        {error ? <Banner tone="danger">{error}</Banner> : null}
        <Button variant="primary" onClick={() => void connect()} disabled={busy || code.trim().length === 0}>
          {busy ? 'Connecting...' : 'Connect'}
        </Button>
      </Card>
    );
  }

  const usable = state.devices.filter((device) => !device.isSystem);
  const blockedDevice = (d: UsbDevice) => (requireRemovable && !d.removable) || (removableOnly && !['usb', 'sd'].includes(d.bus));
  if (desktop) return <Card title="Target USB">
    <div className="drive-picker">
      <Field label="Drive to erase"><select className="input" value={selectedDeviceId} onChange={event => onSelectDevice(event.target.value)}>
        <option value="">Select a drive...</option>
        {usable.map(d => <option key={d.id} value={d.id} disabled={blockedDevice(d)}>
          {d.description} · {formatBytes(d.sizeBytes)} · {d.mountPoints.join(' ') || d.id}
        </option>)}
      </select></Field>
      <Button onClick={() => void refreshDevices()} disabled={busy}>{busy ? 'Refreshing...' : 'Refresh drive list'}</Button>
    </div>
    <div className="drive-options">
      <Toggle checked={requireRemovable} disabled={removableOnly} onChange={onRequireRemovableChange} label="Removable drives only" />
      <Toggle checked={keepIso} onChange={onKeepIsoChange} label="Keep downloaded ISO" />
    </div>
    {error && <Banner tone="danger">{error}</Banner>}
  </Card>;

  return (
    <Card
      title="USB drive"
      subtitle={`Helper connected on ${state.info?.platform ?? 'this computer'}${state.info?.elevated ? '' : ' (not running as administrator or root)'}.`}
    >
      {state.info && !state.info.elevated ? (
        <Banner tone="warning" title="Not elevated">
          Formatting a drive needs administrator or root privileges. Restart the helper elevated, otherwise writing will fail
          part-way through.
        </Banner>
      ) : null}

      {usable.length === 0 ? (
        <Banner tone="warning">No usable drive found. Plug in a USB stick of 8 GB or more, then refresh.</Banner>
      ) : (
        <ul className="devices">
          {usable.map((device) => {
            const blocked = blockedDevice(device);
            return (
            <li key={device.id}>
              <label className={`device ${selectedDeviceId === device.id ? 'device--selected' : ''} ${blocked ? 'device--blocked' : ''}`}>
                <input
                  type="radio"
                  name="device"
                  disabled={blocked}
                  checked={selectedDeviceId === device.id}
                  onChange={() => onSelectDevice(device.id)}
                />
                <span>
                  <strong>{device.description}</strong>
                  <span className="device__meta">
                    {formatBytes(device.sizeBytes)} · {device.bus} · {device.removable ? 'removable' : 'fixed disk'}
                    {device.mountPoints.length > 0 ? ` · ${device.mountPoints.join(' ')}` : ''}
                  </span>
                  {blocked ? (
                    <span className="device__meta">Not offered while the removable-only check is on.</span>
                  ) : null}
                </span>
              </label>
            </li>
            );
          })}
        </ul>
      )}

      <Toggle
        checked={requireRemovable}
        disabled={removableOnly}
        onChange={onRequireRemovableChange}
        label="Only allow removable drives"
        description="Keep this on unless you know exactly what you are doing. The drive this computer boots from is always refused, whatever this is set to."
      />

      <Toggle
        checked={keepIso}
        onChange={onKeepIsoChange}
        label="Keep the downloaded ISO on this computer"
        description="Keep a copy of the official download after the USB is built."
      />

      {!keepIso && state.info?.workDirectory ? (
        <p className="muted">
          Temporary space used during the build: <code>{state.info.workDirectory}</code>. Emptied afterwards.
        </p>
      ) : null}

      {error ? <Banner tone="danger">{error}</Banner> : null}
      <Button onClick={() => void refreshDevices()} disabled={busy}>
        {busy ? 'Refreshing...' : 'Refresh drive list'}
      </Button>
    </Card>
  );
}
