import type { BuildPlan, JobProgress, UsbDevice } from '@shared/types.js';
import { formatBytes, formatDuration, formatRate } from '@shared/format.js';
import { Banner, Button, Card } from './ui.tsx';

const PHASE_LABELS: Record<string, string> = {
  queued: 'Waiting to start',
  downloading: 'Downloading Windows from Microsoft',
  verifying: 'Checking the download',
  partitioning: 'Erasing and formatting the USB stick',
  extracting: 'Copying the installer files',
  'splitting-wim': 'Splitting the Windows image for FAT32',
  injecting: 'Applying your settings',
  finalizing: 'Finishing up',
  done: 'Finished',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function PlanSummary({ plan, device }: { plan: BuildPlan; device?: UsbDevice | undefined }) {
  return (
    <Card title="What this USB stick will do">
      {device ? (
        <Banner tone="danger" title="Everything on this drive will be erased">
          {device.description} ({formatBytes(device.sizeBytes)}) will be wiped and rebuilt as a Windows 11 installer.
        </Banner>
      ) : null}

      <ul className="summary">
        {plan.summary.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      {plan.bootSteps.length > 0 ? (
        <div className="walkthrough">
          <h3>Then, on the PC you are installing</h3>
          <ol className="steps">
            {plan.bootSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      ) : null}

      {plan.warnings.length > 0 ? (
        <Banner tone="warning" title="Worth knowing">
          <ul className="summary">
            {plan.warnings.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Banner>
      ) : null}

      <details className="details">
        <summary>Files that will be changed on the stick ({plan.injectedFiles.length + plan.removedPaths.length})</summary>
        <div className="details__body">
          <ul className="files">
            {plan.removedPaths.map((entry) => (
              <li key={entry.path}>
                <code className="removed">- {entry.path}</code>
                <span>{entry.purpose}</span>
              </li>
            ))}
            {plan.injectedFiles.map((file) => (
              <li key={file.path}>
                <code className="added">+ {file.path}</code>
                <span>{file.purpose}</span>
              </li>
            ))}
          </ul>
        </div>
      </details>
    </Card>
  );
}

export function ProgressPanel({
  progress,
  log,
  bootSteps,
  onCancel,
  onReset,
}: {
  progress: JobProgress;
  log: string[];
  bootSteps: string[];
  onCancel: () => void;
  onReset: () => void;
}) {
  const finished = progress.phase === 'done' || progress.phase === 'failed' || progress.phase === 'cancelled';
  const percent = Math.round(progress.overallProgress * 100);

  return (
    <Card title={PHASE_LABELS[progress.phase] ?? progress.phase}>
      <div className="progress">
        <div
          className={`progress__bar progress__bar--${progress.phase === 'failed' ? 'failed' : progress.phase === 'done' ? 'done' : 'running'}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="progress__label">
        {percent}% · {progress.message}
      </p>

      {progress.bytesTotal ? (
        <p className="muted">
          {formatBytes(progress.bytesDone ?? 0)} of {formatBytes(progress.bytesTotal)}
          {progress.bytesPerSecond ? ` · ${formatRate(progress.bytesPerSecond)}` : ''}
          {progress.etaSeconds ? ` · ${formatDuration(progress.etaSeconds)} left` : ''}
        </p>
      ) : null}

      {progress.phase === 'done' ? (
        <Banner tone="success" title="Ready. Eject the stick and boot the target PC from it.">
          <ol className="steps">
            {bootSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </Banner>
      ) : null}
      {progress.error ? (
        <Banner tone="danger" title="It did not work">
          {progress.error}
        </Banner>
      ) : null}
      {progress.phase === 'cancelled' ? (
        <Banner tone="warning">
          The stick was left half written and will not boot. Run the job again to rebuild it from scratch.
        </Banner>
      ) : null}

      <details className="details">
        <summary>Detailed log ({log.length} lines)</summary>
        <pre className="log">{log.slice(-200).join('\n')}</pre>
      </details>

      {finished ? (
        <Button variant="primary" onClick={onReset}>
          Make another stick
        </Button>
      ) : (
        <Button variant="danger" onClick={onCancel}>
          Cancel
        </Button>
      )}
    </Card>
  );
}
