import { spawn, type SpawnOptions } from 'node:child_process';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export class CommandError extends Error {
  constructor(
    readonly command: string,
    readonly result: RunResult,
  ) {
    super(`${command} exited with code ${result.code}: ${(result.stderr || result.stdout).trim().slice(0, 500)}`);
    this.name = 'CommandError';
  }
}

/**
 * Every external command is spawned with an argument array and never through a
 * shell, so device paths and labels can never be interpreted as commands.
 */
export function run(command: string, args: string[], options: SpawnOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

export async function runOrThrow(command: string, args: string[], options: SpawnOptions = {}): Promise<RunResult> {
  const result = await run(command, args, options);
  if (result.code !== 0) throw new CommandError([command, ...args].join(' '), result);
  return result;
}

/** Runs a command and streams stdout to `onLine`, for progress-reporting tools. */
export function runStreaming(
  command: string,
  args: string[],
  onLine: (line: string, stream: 'stdout' | 'stderr') => void,
  options: SpawnOptions = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';
    const pump = (stream: 'stdout' | 'stderr') => {
      let buffer = '';
      return (chunk: Buffer) => {
        const text = chunk.toString();
        if (stream === 'stdout') stdout += text;
        else stderr += text;
        buffer += text;
        // Some tools use \r to redraw a progress line rather than \n.
        const parts = buffer.split(/\r\n|\r|\n/);
        buffer = parts.pop() ?? '';
        for (const line of parts) if (line.length > 0) onLine(line, stream);
      };
    };
    child.stdout?.on('data', pump('stdout'));
    child.stderr?.on('data', pump('stderr'));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

/** True when the command exists and can be executed. */
export async function commandExists(command: string, probeArgs: string[] = ['--version']): Promise<boolean> {
  try {
    const result = await run(command, probeArgs);
    return result.code !== -1;
  } catch {
    return false;
  }
}

/** Runs a PowerShell snippet that writes JSON to stdout. */
export async function powershellJson<T>(script: string): Promise<T> {
  const result = await runOrThrow('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script,
  ]);
  const text = result.stdout.trim();
  if (text.length === 0) return [] as unknown as T;
  return JSON.parse(text) as T;
}
