import type { WindowsBuildConfig, UiMode } from '../types.js';
import { recommendedPrivacyTweakIds } from './privacy.js';

/**
 * Store apps removed when "remove preinstalled apps" is on. Deliberately
 * conservative: nothing here is required by Windows, and Store, Photos,
 * Calculator, Terminal, Notepad and the security stack are all left alone.
 */
export const defaultDebloatPackages: string[] = [
  'Microsoft.3DBuilder',
  'Microsoft.549981C3F5F10', // Cortana app
  'Microsoft.BingFinance',
  'Microsoft.BingNews',
  'Microsoft.BingSearch',
  'Microsoft.BingSports',
  'Microsoft.BingWeather',
  'Microsoft.GamingApp',
  'Microsoft.GetHelp',
  'Microsoft.Getstarted',
  'Microsoft.MicrosoftOfficeHub',
  'Microsoft.MicrosoftSolitaireCollection',
  'Microsoft.MixedReality.Portal',
  'Microsoft.NetworkSpeedTest',
  'Microsoft.Office.OneNote',
  'Microsoft.OutlookForWindows',
  'Microsoft.People',
  'Microsoft.SkypeApp',
  'Microsoft.Todos',
  'Microsoft.Wallet',
  'Microsoft.WindowsFeedbackHub',
  'Microsoft.WindowsMaps',
  'Microsoft.Xbox.TCUI',
  'Microsoft.XboxApp',
  'Microsoft.XboxGameOverlay',
  'Microsoft.XboxGamingOverlay',
  'Microsoft.XboxSpeechToTextOverlay',
  'Microsoft.YourPhone',
  'Microsoft.ZuneMusic',
  'Microsoft.ZuneVideo',
  'MicrosoftCorporationII.MicrosoftFamily',
  'MicrosoftTeams',
  'MSTeams',
  'Clipchamp.Clipchamp',
];

export function defaultWindowsConfig(mode: UiMode = 'easy'): WindowsBuildConfig {
  return {
    mode,
    image: {
      variantId: 'win11-consumer',
      arch: 'x64',
      language: 'en-US',
      // Easy mode keeps the edition picker so one USB installs Home or Pro.
      edition: { kind: 'ask-at-install' },
    },
    account: {
      username: '',
      password: '',
      autoLogon: false,
      autoLogonCount: 1,
      administrator: true,
      skipSecurityQuestions: true,
    },
    region: {
      uiLanguage: 'en-US',
      userLocale: 'en-US',
      inputLocale: '0409:00000409',
      timeZone: '',
      geoId: '',
    },
    setup: {
      // Never destructive by default. The user opts in explicitly.
      disk: { kind: 'interactive' },
      bypassRequirements: true,
      bypassNetworkRequirement: true,
      computerName: '',
      skipOobe: true,
      skipMicrosoftAccount: true,
      disableExpressSettings: true,
    },
    wifi: {
      enabled: false,
      ssid: '',
      password: '',
      hidden: false,
    },
    privacy: [...recommendedPrivacyTweakIds],
    debloat: {
      removeProvisionedApps: true,
      packages: [...defaultDebloatPackages],
      disableOneDriveSetup: true,
      disableCopilot: true,
    },
    extraSetupCommands: [],
  };
}
