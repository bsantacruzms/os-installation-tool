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

export function AgentPanel({
  state,
  onConnected,
  selectedDeviceId,
  onSelectDevice,
  requireRemovable,
  onRequireRemovableChange,
  keepIso,
  onKeepIsoChange,
}: {
  state: AgentState;
  onConnected: (next: AgentState) => void;
  selectedDeviceId: string;
  onSelectDevice: (id: string) => void;
  requireRemovable: boolean;
  onRequireRemovableChange: (value: boolean) => void;
  keepIso: boolean;
  onKeepIsoChange: (value: boolean) => void;
}) {
  const [baseUrl, setBaseUrl] = useState(guessAgentUrl);
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<'idle' | 'checking' | 'found' | 'missing'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setStatus('checking');
    AgentClient.ping(baseUrl.replace(/\/$/, ''))
      .then(() => !cancelled && setStatus('found'))
      .catch(() => !cancelled && setStatus('missing'));
    return () => {
      cancelled = true;
    };
  }, [baseUrl]);

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
    return (
      <Card
        title="Connect this computer"
        subtitle="A browser cannot format a USB stick on its own. A small helper runs on your machine and does the privileged work; this page just tells it what to build."
      >
        {status === 'missing' ? (
          <Banner tone="info" title="Helper not detected">
            <p>Get it once, then run it whenever you want to build a stick:</p>
            <pre className="code">{`git clone https://github.com/bsantacruzms/os-installation-tool
cd os-installation-tool
npm run setup && npm run build
npm run dev:agent`}</pre>
            <p>
              On Windows use an Administrator terminal. On macOS and Linux use <code>sudo</code>. It prints a pairing code; type
              that below.
            </p>
            <p>
              If your browser refuses to talk to it, open <code>http://127.0.0.1:5179</code> instead. The helper serves this
              same page locally.
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
            const blocked = requireRemovable && !device.removable;
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
        onChange={onRequireRemovableChange}
        label="Only allow removable drives"
        description="Keep this on unless you know exactly what you are doing. The drive this computer boots from is always refused, whatever this is set to."
      />

      <Toggle
        checked={keepIso}
        onChange={onKeepIsoChange}
        label="Keep the downloaded Windows ISO on this computer"
        description="Off by default, so a borrowed or shared machine is left exactly as you found it. Turn it on to save the download and make a second stick without fetching 8.5 GB again."
      />

      {error ? <Banner tone="danger">{error}</Banner> : null}
      <Button onClick={() => void refreshDevices()} disabled={busy}>
        {busy ? 'Refreshing...' : 'Refresh drive list'}
      </Button>
    </Card>
  );
}
