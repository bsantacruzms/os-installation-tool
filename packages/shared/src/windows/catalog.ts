import type { ImageVariant } from '../types.js';

export const windowsImageVariants: readonly ImageVariant[] = [
  {
    id: 'win11-consumer',
    family: 'windows',
    name: 'Windows 11 (latest)',
    description:
      'The official multi-edition ISO from Microsoft. One download installs Home, Pro, Education and their N variants, so you pick the edition while installing.',
    source: 'microsoft-download-api',
    editions: ['home', 'home-n', 'home-single-language', 'pro', 'pro-n', 'pro-education', 'pro-workstations', 'education'],
    arches: ['x64', 'arm64'],
    approximateBytes: 8_500_000_000,
    landingUrl: 'https://www.microsoft.com/software-download/windows11',
    notes: [
      'Downloaded straight from Microsoft. Nothing is mirrored or repackaged.',
      'Windows 11 Enterprise is not part of this ISO.',
    ],
  },
  {
    id: 'win11-enterprise-eval',
    family: 'windows',
    name: 'Windows 11 Enterprise (evaluation)',
    description:
      'The 90 day evaluation build from the Microsoft Evaluation Center. This is the only Enterprise media Microsoft offers publicly.',
    source: 'direct',
    editions: ['enterprise'],
    arches: ['x64'],
    approximateBytes: 6_500_000_000,
    evaluation: true,
    landingUrl: 'https://www.microsoft.com/evalcenter/evaluate-windows-11-enterprise',
    notes: [
      'Expires after 90 days unless you supply a volume licence key.',
      'Microsoft requires a short registration form, so the download link has to be fetched from the Evaluation Center.',
    ],
  },
  {
    id: 'win11-ltsc-eval',
    family: 'windows',
    name: 'Windows 11 Enterprise LTSC 2024 (evaluation)',
    description:
      'Feature-frozen long term servicing build with no Store apps and five years of security updates. Popular for kiosks, labs and machines that must not change.',
    source: 'direct',
    editions: ['enterprise-ltsc'],
    arches: ['x64'],
    approximateBytes: 5_200_000_000,
    evaluation: true,
    landingUrl: 'https://www.microsoft.com/evalcenter/evaluate-windows-11-enterprise-ltsc-2024',
    notes: ['Evaluation media expires after 90 days.', 'No Microsoft Store, Copilot or Widgets in this edition.'],
  },
  {
    id: 'custom-iso',
    family: 'windows',
    name: 'Use my own ISO',
    description: 'Point at an ISO you already downloaded. Everything else works exactly the same.',
    source: 'local',
    editions: [],
    arches: ['x64', 'arm64'],
  },
] as const;

export function findWindowsVariant(id: string): ImageVariant | undefined {
  return windowsImageVariants.find((v) => v.id === id);
}

export interface LanguageOption {
  /** Value Microsoft's download service expects, e.g. `English (United States)`. */
  microsoftName: string;
  /** BCP-47 tag used everywhere else in the tool. */
  tag: string;
  label: string;
  /** Default keyboard layout id pair for this language. */
  inputLocale: string;
}

/** The most common of Microsoft's 38 ISO languages. The server returns the live list. */
export const commonLanguages: readonly LanguageOption[] = [
  { microsoftName: 'English', tag: 'en-US', label: 'English (United States)', inputLocale: '0409:00000409' },
  { microsoftName: 'English International', tag: 'en-GB', label: 'English (International)', inputLocale: '0809:00000809' },
  { microsoftName: 'Spanish', tag: 'es-ES', label: 'Spanish (Spain)', inputLocale: '0c0a:0000040a' },
  { microsoftName: 'Spanish (Mexico)', tag: 'es-MX', label: 'Spanish (Mexico)', inputLocale: '080a:0000080a' },
  { microsoftName: 'French', tag: 'fr-FR', label: 'French', inputLocale: '040c:0000040c' },
  { microsoftName: 'French Canadian', tag: 'fr-CA', label: 'French (Canada)', inputLocale: '0c0c:00001009' },
  { microsoftName: 'German', tag: 'de-DE', label: 'German', inputLocale: '0407:00000407' },
  { microsoftName: 'Italian', tag: 'it-IT', label: 'Italian', inputLocale: '0410:00000410' },
  { microsoftName: 'Brazilian Portuguese', tag: 'pt-BR', label: 'Portuguese (Brazil)', inputLocale: '0416:00000416' },
  { microsoftName: 'Portuguese', tag: 'pt-PT', label: 'Portuguese (Portugal)', inputLocale: '0816:00000816' },
  { microsoftName: 'Dutch', tag: 'nl-NL', label: 'Dutch', inputLocale: '0413:00020409' },
  { microsoftName: 'Polish', tag: 'pl-PL', label: 'Polish', inputLocale: '0415:00000415' },
  { microsoftName: 'Russian', tag: 'ru-RU', label: 'Russian', inputLocale: '0419:00000419' },
  { microsoftName: 'Japanese', tag: 'ja-JP', label: 'Japanese', inputLocale: '0411:00000411' },
  { microsoftName: 'Korean', tag: 'ko-KR', label: 'Korean', inputLocale: '0412:00000412' },
  { microsoftName: 'Chinese (Simplified)', tag: 'zh-CN', label: 'Chinese (Simplified)', inputLocale: '0804:00000804' },
  { microsoftName: 'Chinese (Traditional)', tag: 'zh-TW', label: 'Chinese (Traditional)', inputLocale: '0404:00000404' },
] as const;

export function findLanguage(tag: string): LanguageOption | undefined {
  return commonLanguages.find((l) => l.tag === tag);
}
