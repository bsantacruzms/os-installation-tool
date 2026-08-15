export type RegHive = 'HKLM' | 'HKCU-DEFAULT';

export type RegType = 'REG_DWORD' | 'REG_SZ' | 'REG_EXPAND_SZ';

export interface RegistryOp {
  hive: RegHive;
  /** Key path below the hive, e.g. `SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection`. */
  key: string;
  name: string;
  type: RegType;
  value: string | number;
}

export type PrivacyCategory = 'telemetry' | 'ads' | 'search' | 'ai' | 'location' | 'cloud' | 'edge' | 'convenience';

export interface PrivacyTweak {
  id: string;
  label: string;
  /** Plain language description of exactly what changes. */
  description: string;
  category: PrivacyCategory;
  /** Enabled by default in Easy mode. */
  recommended: boolean;
  /** Something the user visibly loses. Surfaced in the UI next to the toggle. */
  tradeoff?: string;
  registry: RegistryOp[];
  /** Extra commands appended to the post-setup script. */
  commands?: string[];
}

const HKLM = 'HKLM' as const;
const HKCU = 'HKCU-DEFAULT' as const;

/**
 * Every tweak here is a documented Windows policy or user setting. Nothing
 * disables Windows Update, Defender or Smart App Control, because a bootable
 * installer should never quietly weaken a machine's security posture.
 */
export const privacyTweaks: readonly PrivacyTweak[] = [
  {
    id: 'telemetry',
    label: 'Minimise diagnostic data',
    description:
      'Sets the diagnostic data policy to the lowest value the edition allows and stops the Connected User Experiences uploader from running.',
    category: 'telemetry',
    recommended: true,
    tradeoff: 'Home and Pro clamp to "Required" rather than "Off"; only Enterprise/Education honour a true 0.',
    registry: [
      { hive: HKLM, key: 'SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection', name: 'AllowTelemetry', type: 'REG_DWORD', value: 0 },
      { hive: HKLM, key: 'SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection', name: 'AllowDeviceNameInTelemetry', type: 'REG_DWORD', value: 0 },
      { hive: HKLM, key: 'SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection', name: 'DoNotShowFeedbackNotifications', type: 'REG_DWORD', value: 1 },
      { hive: HKLM, key: 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\DataCollection', name: 'AllowTelemetry', type: 'REG_DWORD', value: 0 },
      { hive: HKCU, key: 'SOFTWARE\\Microsoft\\Siuf\\Rules', name: 'NumberOfSIUFInPeriod', type: 'REG_DWORD', value: 0 },
    ],
    commands: [
      'sc.exe config DiagTrack start= disabled',
      'sc.exe config dmwappushservice start= disabled',
      'schtasks.exe /Change /TN "\\Microsoft\\Windows\\Application Experience\\ProgramDataUpdater" /Disable',
      'schtasks.exe /Change /TN "\\Microsoft\\Windows\\Customer Experience Improvement Program\\Consolidator" /Disable',
    ],
  },
  {
    id: 'error-reporting',
    label: 'Disable Windows Error Reporting uploads',
    description: 'Stops crash dumps and error reports from being sent to Microsoft. Crashes are still logged locally.',
    category: 'telemetry',
    recommended: true,
    registry: [
      { hive: HKLM, key: 'SOFTWARE\\Policies\\Microsoft\\Windows\\Windows Error Reporting', name: 'Disabled', type: 'REG_DWORD', value: 1 },
    ],
  },
  {
    id: 'advertising-id',
    label: 'Turn off the advertising ID',
    description: 'Apps can no longer read a per-user advertising identifier to profile you across the system.',
    category: 'ads',
    recommended: true,
    registry: [
      { hive: HKLM, key: 'SOFTWARE\\Policies\\Microsoft\\Windows\\AdvertisingInfo', name: 'DisabledByGroupPolicy', type: 'REG_DWORD', value: 1 },
      { hive: HKCU, key: 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AdvertisingInfo', name: 'Enabled', type: 'REG_DWORD', value: 0 },
    ],
  },
  {
    id: 'tailored-experiences',
    label: 'Turn off tailored experiences',
    description: 'Microsoft stops using your diagnostic data to personalise tips, ads and recommendations.',
    category: 'ads',
    recommended: true,
    registry: [
      { hive: HKLM, key: 'SOFTWARE\\Policies\\Microsoft\\Windows\\CloudContent', name: 'DisableTailoredExperiencesWithDiagnosticData', type: 'REG_DWORD', value: 1 },
      { hive: HKCU, key: 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Privacy', name: 'TailoredExperiencesWithDiagnosticDataEnabled', type: 'REG_DWORD', value: 0 },
    ],
  },
  {
    id: 'consumer-features',
    label: 'Stop automatic app installs and suggestions',
    description:
      'Blocks the "consumer experience" that silently installs promoted apps and games on first login, and removes Start menu, lock screen and settings suggestions.',
    category: 'ads',
    recommended: true,
    registry: [
      { hive: HKLM, key: 'SOFTWARE\\Policies\\Microsoft\\Windows\\CloudContent', name: 'DisableWindowsConsumerFeatures', type: 'REG_DWORD', value: 1 },
      { hive: HKLM, key: 'SOFTWARE\\Policies\\Microsoft\\Windows\\CloudContent', name: 'DisableConsumerAccountStateContent', type: 'REG_DWORD', value: 1 },
      { hive: HKLM, key: 'SOFTWARE\\Policies\\Microsoft\\Windows\\CloudContent', name: 'DisableSoftLanding', type: 'REG_DWORD', value: 1 },
      { hive: HKCU, key: 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager', name: 'SilentInstalledAppsEnabled', type: 'REG_DWORD', value: 0 },
      { hive: HKCU, key: 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager', name: 'SystemPaneSuggestionsEnabled', type: 'REG_DWORD', value: 0 },
      { hive: HKCU, key: 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager', name: 'SubscribedContent-338388Enabled', type: 'REG_DWORD', value: 0 },
      { hive: HKCU, key: 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager', name: 'SubscribedContent-338389Enabled', type: 'REG_DWORD', value: 0 },
      { hive: HKCU, key: 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager', name: 'SubscribedContent-310093Enabled', type: 'REG_DWORD', value: 0 },
      { hive: HKCU, key: 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager', name: 'RotatingLockScreenOverlayEnabled', type: 'REG_DWORD', value: 0 },
    ],
  },
  {
    id: 'web-search',
    label: 'Remove web results from Start menu search',
    description: 'Typing in Start searches your PC only. Nothing is sent to Bing as you type.',
    category: 'search',
    recommended: true,
    tradeoff: 'You lose inline web answers in the Start menu.',
    registry: [
      { hive: HKLM, key: 'SOFTWARE\\Policies\\Microsoft\\Windows\\Windows Search', name: 'DisableWebSearch', type: 'REG_DWORD', value: 1 },
      { hive: HKLM, key: 'SOFTWARE\\Policies\\Microsoft\\Windows\\Windows Search', name: 'ConnectedSearchUseWeb', type: 'REG_DWORD', value: 0 },
      { hive: HKLM, key: 'SOFTWARE\\Policies\\Microsoft\\Windows\\Explorer', name: 'DisableSearchBoxSuggestions', type: 'REG_DWORD', value: 1 },
      { hive: HKCU, key: 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\SearchSettings', name: 'IsDynamicSearchBoxEnabled', type: 'REG_DWORD', value: 0 },
    ],
  },
  {
    id: 'cortana',
    label: 'Disable Cortana',
    description: 'Cortana is not started and cannot index or transmit voice input.',
    category: 'search',
    recommended: true,
    registry: [
      { hive: HKLM, key: 'SOFTWARE\\Policies\\Microsoft\\Windows\\Windows Search', name: 'AllowCortana', type: 'REG_DWORD', value: 0 },
    ],
  },
  {
    id: 'copilot-recall',
    label: 'Disable Copilot and Recall',
    description:
      'Turns off Windows Copilot and blocks Recall from taking periodic screenshots of everything you do.',
    category: 'ai',
    recommended: true,
    registry: [
      { hive: HKLM, key: 'SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsCopilot', name: 'TurnOffWindowsCopilot', type: 'REG_DWORD', value: 1 },
      { hive: HKLM, key: 'SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsAI', name: 'DisableAIDataAnalysis', type: 'REG_DWORD', value: 1 },
      { hive: HKLM, key: 'SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsAI', name: 'AllowRecallEnablement', type: 'REG_DWORD', value: 0 },
      { hive: HKCU, key: 'SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsCopilot', name: 'TurnOffWindowsCopilot', type: 'REG_DWORD', value: 1 },
    ],
  },
  {
    id: 'typing-inking',
    label: 'Stop sending typing and handwriting samples',
    description: 'Disables inking and typing personalisation, which otherwise uploads a personal dictionary.',
    category: 'ai',
    recommended: true,
    tradeoff: 'Autocorrect and text suggestions get slightly less accurate over time.',
    registry: [
      { hive: HKLM, key: 'SOFTWARE\\Policies\\Microsoft\\InputPersonalization', name: 'AllowInputPersonalization', type: 'REG_DWORD', value: 0 },
      { hive: HKCU, key: 'SOFTWARE\\Microsoft\\InputPersonalization', name: 'RestrictImplicitTextCollection', type: 'REG_DWORD', value: 1 },
      { hive: HKCU, key: 'SOFTWARE\\Microsoft\\InputPersonalization', name: 'RestrictImplicitInkCollection', type: 'REG_DWORD', value: 1 },
      { hive: HKCU, key: 'SOFTWARE\\Microsoft\\Personalization\\Settings', name: 'AcceptedPrivacyPolicy', type: 'REG_DWORD', value: 0 },
      { hive: HKCU, key: 'SOFTWARE\\Microsoft\\Speech_OneCore\\Settings\\OnlineSpeechPrivacy', name: 'HasAccepted', type: 'REG_DWORD', value: 0 },
    ],
  },
  {
    id: 'location',
    label: 'Deny location access by default',
    description: 'The location service starts disabled. Individual apps can still be granted access later in Settings.',
    category: 'location',
    recommended: true,
    tradeoff: 'Weather, Maps and "Find my device" need location to be re-enabled manually.',
    registry: [
      { hive: HKLM, key: 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\location', name: 'Value', type: 'REG_SZ', value: 'Deny' },
      { hive: HKLM, key: 'SOFTWARE\\Policies\\Microsoft\\Windows\\LocationAndSensors', name: 'DisableLocation', type: 'REG_DWORD', value: 1 },
    ],
  },
  {
    id: 'activity-history',
    label: 'Disable activity history sync',
    description: 'Your app and document history is not collected or uploaded to your Microsoft account.',
    category: 'cloud',
    recommended: true,
    registry: [
      { hive: HKLM, key: 'SOFTWARE\\Policies\\Microsoft\\Windows\\System', name: 'EnableActivityFeed', type: 'REG_DWORD', value: 0 },
      { hive: HKLM, key: 'SOFTWARE\\Policies\\Microsoft\\Windows\\System', name: 'PublishUserActivities', type: 'REG_DWORD', value: 0 },
      { hive: HKLM, key: 'SOFTWARE\\Policies\\Microsoft\\Windows\\System', name: 'UploadUserActivities', type: 'REG_DWORD', value: 0 },
    ],
  },
  {
    id: 'wifi-sense',
    label: 'Disable Wi-Fi Sense and hotspot reporting',
    description: 'Stops Windows from sharing Wi-Fi credentials and reporting open hotspots it sees.',
    category: 'cloud',
    recommended: true,
    registry: [
      { hive: HKLM, key: 'SOFTWARE\\Microsoft\\PolicyManager\\default\\WiFi\\AllowWiFiHotSpotReporting', name: 'Value', type: 'REG_DWORD', value: 0 },
      { hive: HKLM, key: 'SOFTWARE\\Microsoft\\PolicyManager\\default\\WiFi\\AllowAutoConnectToWiFiSenseHotspots', name: 'Value', type: 'REG_DWORD', value: 0 },
    ],
  },
  {
    id: 'edge-telemetry',
    label: 'Harden Microsoft Edge',
    description:
      'Turns off Edge usage metrics, personalisation reporting, the first-run experience and the shopping/price-comparison features.',
    category: 'edge',
    recommended: true,
    registry: [
      { hive: HKLM, key: 'SOFTWARE\\Policies\\Microsoft\\Edge', name: 'MetricsReportingEnabled', type: 'REG_DWORD', value: 0 },
      { hive: HKLM, key: 'SOFTWARE\\Policies\\Microsoft\\Edge', name: 'PersonalizationReportingEnabled', type: 'REG_DWORD', value: 0 },
      { hive: HKLM, key: 'SOFTWARE\\Policies\\Microsoft\\Edge', name: 'HideFirstRunExperience', type: 'REG_DWORD', value: 1 },
      { hive: HKLM, key: 'SOFTWARE\\Policies\\Microsoft\\Edge', name: 'EdgeShoppingAssistantEnabled', type: 'REG_DWORD', value: 0 },
      { hive: HKLM, key: 'SOFTWARE\\Policies\\Microsoft\\Edge', name: 'UserFeedbackAllowed', type: 'REG_DWORD', value: 0 },
      { hive: HKLM, key: 'SOFTWARE\\Policies\\Microsoft\\Edge', name: 'DiagnosticData', type: 'REG_DWORD', value: 0 },
    ],
  },
  {
    id: 'onedrive-setup',
    label: 'Do not auto-start OneDrive setup',
    description: 'OneDrive stays installed but never nags on first login and does not silently back up your folders.',
    category: 'cloud',
    recommended: true,
    registry: [
      { hive: HKLM, key: 'SOFTWARE\\Policies\\Microsoft\\Windows\\OneDrive', name: 'DisableFileSyncNGSC', type: 'REG_DWORD', value: 1 },
      { hive: HKLM, key: 'SOFTWARE\\Policies\\Microsoft\\Windows\\OneDrive', name: 'KFMBlockOptIn', type: 'REG_DWORD', value: 1 },
    ],
  },
  {
    id: 'app-permissions',
    label: 'Deny background app access to camera, mic and account info',
    description:
      'Sets the default consent for the most sensitive capabilities to Deny. Apps you actually use can be allowed individually.',
    category: 'convenience',
    recommended: false,
    tradeoff: 'Video calling and voice apps need permission granted manually the first time.',
    registry: [
      { hive: HKLM, key: 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\userAccountInformation', name: 'Value', type: 'REG_SZ', value: 'Deny' },
      { hive: HKLM, key: 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\appDiagnostics', name: 'Value', type: 'REG_SZ', value: 'Deny' },
      { hive: HKLM, key: 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\contacts', name: 'Value', type: 'REG_SZ', value: 'Deny' },
    ],
  },
  {
    id: 'lock-screen-spotlight',
    label: 'Plain lock screen instead of Windows Spotlight',
    description: 'The lock screen stops downloading rotating images that carry ads and "fun facts".',
    category: 'ads',
    recommended: false,
    registry: [
      { hive: HKLM, key: 'SOFTWARE\\Policies\\Microsoft\\Windows\\CloudContent', name: 'DisableWindowsSpotlightFeatures', type: 'REG_DWORD', value: 1 },
      { hive: HKCU, key: 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager', name: 'RotatingLockScreenEnabled', type: 'REG_DWORD', value: 0 },
    ],
  },
];

export const recommendedPrivacyTweakIds: string[] = privacyTweaks.filter((t) => t.recommended).map((t) => t.id);

export const allPrivacyTweakIds: string[] = privacyTweaks.map((t) => t.id);

export function findPrivacyTweak(id: string): PrivacyTweak | undefined {
  return privacyTweaks.find((t) => t.id === id);
}
