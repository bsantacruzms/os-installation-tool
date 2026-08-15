import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

import type { CreateUsbRequest, JobPhase, JobProgress } from '../../shared/src/types.js';
import { createBootableUsb } from './usb/writer.js';

export interface JobRecord {
  id: string;
  request: CreateUsbRequest;
  progress: JobProgress;
  log: string[];
  startedAt: number;
  finishedAt?: number;
  controller: AbortController;
}

const TERMINAL: JobPhase[] = ['done', 'failed', 'cancelled'];

export class JobManager extends EventEmitter {
  private readonly jobs = new Map<string, JobRecord>();

  constructor(private readonly workDirectory: string) {
    super();
  }

  list(): JobProgress[] {
    return [...this.jobs.values()].map((job) => job.progress);
  }

  get(id: string): JobRecord | undefined {
    return this.jobs.get(id);
  }

  /** Only one destructive job at a time: two writers would fight over the disk. */
  hasActiveJob(): boolean {
    return [...this.jobs.values()].some((job) => !TERMINAL.includes(job.progress.phase));
  }

  start(request: CreateUsbRequest): JobRecord {
    if (this.hasActiveJob()) {
      throw new Error('A USB stick is already being written. Wait for it to finish or cancel it first.');
    }

    const id = randomUUID();
    const record: JobRecord = {
      id,
      request,
      progress: { jobId: id, phase: 'queued', phaseProgress: 0, overallProgress: 0, message: 'Queued' },
      log: [],
      startedAt: Date.now(),
      controller: new AbortController(),
    };
    this.jobs.set(id, record);
    this.emitProgress(record);

    void this.run(record);
    return record;
  }

  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || TERMINAL.includes(job.progress.phase)) return false;
    job.controller.abort();
    return true;
  }

  private emitProgress(job: JobRecord): void {
    this.emit('progress', { ...job.progress });
  }

  private appendLog(job: JobRecord, message: string): void {
    job.log.push(`[${new Date().toISOString()}] ${message}`);
    if (job.log.length > 2000) job.log.splice(0, job.log.length - 2000);
    this.emit('log', { jobId: job.id, message });
  }

  private async run(job: JobRecord): Promise<void> {
    try {
      await createBootableUsb({
        request: job.request,
        workDirectory: this.workDirectory,
        signal: job.controller.signal,
        events: {
          onPhase: (phase, message) => {
            job.progress = { ...job.progress, phase, phaseProgress: 0, message };
            this.emitProgress(job);
            this.appendLog(job, `${phase}: ${message}`);
          },
          onProgress: (phase, fraction, overall, message, extra) => {
            job.progress = {
              ...job.progress,
              phase,
              phaseProgress: fraction,
              overallProgress: overall,
              message,
              ...(extra ?? {}),
            };
            this.emitProgress(job);
          },
          onLog: (message) => this.appendLog(job, message),
        },
      });

      job.progress = {
        ...job.progress,
        phase: 'done',
        phaseProgress: 1,
        overallProgress: 1,
        message: 'Your bootable USB stick is ready.',
      };
    } catch (error) {
      const cancelled = job.controller.signal.aborted;
      const message = error instanceof Error ? error.message : String(error);
      job.progress = {
        ...job.progress,
        phase: cancelled ? 'cancelled' : 'failed',
        message: cancelled ? 'Cancelled. The USB stick has been left partly written and is not bootable.' : message,
        ...(cancelled ? {} : { error: message }),
      };
      this.appendLog(job, cancelled ? 'Cancelled by the user.' : `Failed: ${message}`);
    } finally {
      job.finishedAt = Date.now();
      this.emitProgress(job);
    }
  }
}
