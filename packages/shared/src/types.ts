/**
 * Cross-cutting types shared by the web UI, the API server and the local agent.
 */

export type Arch = 'x64' | 'arm64';

export type UiMode = 'easy' | 'advanced';

/* ------------------------------------------------------------------ *
 * Image catalog
 * ------------------------------------------------------------------ */

export type ImageFamily = 'windows' | 'linux';

/** Where the ISO ultimately comes from. */
export type ImageSourceKind =
  /** Resolved live against Microsoft's official software-download service. */
  | 'microsoft-download-api'
  /** A stable, publicly documented direct URL (Microsoft eval centre, distro mirror). */
  | 'direct'
  /** User supplied their own ISO from disk. */
  | 'local';

export interface ImageVariant {
  /** Stable id used by the API and the UI, e.g. `win11-consumer`. */
  id: string;
  family: ImageFamily;
  name: string;
  /** Short marketing-free explanation shown under the name. */
  description: string;
  source: ImageSourceKind;
  /** Editions the resulting ISO can install. */
  editions: string[];
  arches: Arch[];
  /** Approximate download size in bytes, for progress estimates before HEAD. */
  approximateBytes?: number;
  /** True when the ISO is a time limited evaluation build. */
  evaluation?: boolean;
  /** Official page a user can fall back to if automatic resolution fails. */
  landingUrl?: string;
  /** Free-form caveats surfaced verbatim in the UI. */
  notes?: string[];
}

export interface ImageResolution {
  variantId: string;
  arch: Arch;
  /** Language/locale the ISO was resolved for, e.g. `en-US`. */
  language: string;
  url: string;
  fileName: string;
  sizeBytes?: number;
  sha256?: string;
  /** Microsoft download links expire; this is when the URL stops working. */
  expiresAt?: string;
  editions: string[];
}

/* ------------------------------------------------------------------ *
 * Windows build configuration
 * ------------------------------------------------------------------ */

/** How the Windows edition is chosen. */
export type EditionSelection =
  /** Strip `ei.cfg` so Windows Setup shows the edition picker at install time. */
  | { kind: 'ask-at-install' }
  /** Pre-select an edition with its generic (non-activating) setup key. */
  | { kind: 'preselect'; editionId: string };

export interface AccountConfig {
  /** Local account created automatically so OOBE never asks. */
  username: string;
  /** Empty string means "no password". Stored obfuscated, never encrypted. */
  password: string;
  /** Sign in automatically after the first boot. */
  autoLogon: boolean;
  /** Number of automatic logons before Windows asks normally. */
  autoLogonCount: number;
  /** Add the account to the local Administrators group. */
  administrator: boolean;
  /** Security questions Windows 11 demands for local accounts; auto-answered. */
  skipSecurityQuestions: boolean;
}

export interface RegionConfig {
  /** UI language of Windows itself, e.g. `en-US`. */
  uiLanguage: string;
  /** Number/date/currency formats, e.g. `en-US`. */
  userLocale: string;
  /** Keyboard layout id pair, e.g. `0409:00000409`. */
  inputLocale: string;
  /** Windows time zone id, e.g. `Pacific Standard Time`. Empty = keep default. */
  timeZone: string;
  /** Geo location id (`244` = United States). Empty = keep default. */
  geoId: string;
}

export type DiskStrategy =
  /** Show Windows Setup's normal disk picker. The only non-destructive option. */
  | { kind: 'interactive' }
  /** Erase the whole disk and lay down a clean UEFI/GPT layout. Destructive. */
  | { kind: 'wipe-disk'; diskId: number; recoveryPartitionMb: number };

export interface SetupConfig {
  disk: DiskStrategy;
  /** Registry shims that let Windows 11 install on unsupported hardware. */
  bypassRequirements: boolean;
  /** Skip the "connect to a network" wall so a local account is possible. */
  bypassNetworkRequirement: boolean;
  computerName: string;
  /** Accept the EULA and hide every OOBE page we can legally hide. */
  skipOobe: boolean;
  /** Auto answer "no" to the Microsoft account push. */
  skipMicrosoftAccount: boolean;
  /** Show the "Express settings" telemetry opt-in, or force it off. */
  disableExpressSettings: boolean;
}

export interface WifiConfig {
  enabled: boolean;
  ssid: string;
  /** WPA2/WPA3 pre-shared key. */
  password: string;
  hidden: boolean;
}

export interface DebloatConfig {
  /** Remove preinstalled Store apps listed in `packages`. */
  removeProvisionedApps: boolean;
  /** AppX package family name prefixes to strip. */
  packages: string[];
  /** Prevent OneDrive's per-user setup from running. */
  disableOneDriveSetup: boolean;
  /** Hide the Copilot and Recall entry points. */
  disableCopilot: boolean;
}

export interface WindowsBuildConfig {
  mode: UiMode;
  image: {
    variantId: string;
    arch: Arch;
    language: string;
    edition: EditionSelection;
  };
  account: AccountConfig;
  region: RegionConfig;
  setup: SetupConfig;
  wifi: WifiConfig;
  /** Privacy tweak ids that should be applied. See `privacyTweaks`. */
  privacy: string[];
  debloat: DebloatConfig;
  /** Extra commands run once, as SYSTEM, at the end of setup. */
  extraSetupCommands: string[];
}

/* ------------------------------------------------------------------ *
 * Build plan handed to the agent
 * ------------------------------------------------------------------ */

export type FileEncoding = 'utf8' | 'utf16le';

export interface InjectedFile {
  /** Path relative to the root of the USB, using forward slashes. */
  path: string;
  content: string;
  encoding: FileEncoding;
  /** Written verbatim into the UI's "what will be changed" summary. */
  purpose: string;
}

export interface RemovedPath {
  path: string;
  purpose: string;
}

export interface BuildPlan {
  /** Files copied onto the USB after the ISO contents are extracted. */
  injectedFiles: InjectedFile[];
  /** Files deleted from the extracted ISO contents. */
  removedPaths: RemovedPath[];
  /** Human readable list of everything the plan does, for the confirm screen. */
  summary: string[];
  /** What the person in front of the target PC will see, in order. */
  bootSteps: string[];
  /** Non-fatal things the user should know before flashing. */
  warnings: string[];
}

/* ------------------------------------------------------------------ *
 * Agent protocol
 * ------------------------------------------------------------------ */

export type BusType = 'usb' | 'sd' | 'internal' | 'unknown';

export interface UsbDevice {
  /** Platform specific device path: `\\.\PHYSICALDRIVE2`, `/dev/disk4`, `/dev/sdb`. */
  id: string;
  description: string;
  sizeBytes: number;
  bus: BusType;
  removable: boolean;
  /** True when the agent believes this is the drive the OS is running from. */
  isSystem: boolean;
  mountPoints: string[];
}

export type JobPhase =
  | 'queued'
  | 'downloading'
  | 'verifying'
  | 'partitioning'
  | 'extracting'
  | 'splitting-wim'
  | 'injecting'
  | 'finalizing'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface JobProgress {
  jobId: string;
  phase: JobPhase;
  /** 0..1 within the current phase, or null when indeterminate. */
  phaseProgress: number | null;
  /** 0..1 across the whole job. */
  overallProgress: number;
  message: string;
  bytesDone?: number;
  bytesTotal?: number;
  bytesPerSecond?: number;
  etaSeconds?: number;
  error?: string;
}

export interface CreateUsbRequest {
  deviceId: string;
  /** Resolved ISO to download, or a path to a local ISO. */
  iso: { kind: 'url'; url: string; fileName: string; sizeBytes?: number; sha256?: string } | { kind: 'local'; path: string };
  plan: BuildPlan;
  volumeLabel: string;
  /** Fail instead of writing if the device does not look like removable media. */
  requireRemovable: boolean;
  /**
   * Keep the downloaded ISO on this computer afterwards. Off by default, so a
   * borrowed machine is left as it was found. A failed run always keeps the
   * partial file so the next attempt can resume it.
   */
  keepIso?: boolean;
}

export interface AgentInfo {
  version: string;
  /** Node's `process.platform`, e.g. `win32`, `darwin`, `linux`. */
  platform: string;
  arch: string;
  elevated: boolean;
  /** External binaries the agent found, keyed by tool name. */
  capabilities: Record<string, boolean>;
}
