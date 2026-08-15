import type { WindowsBuildConfig } from '@shared/types.js';
import { recommendedPrivacyTweakIds } from '@shared/windows/privacy.js';
import type { Catalog } from '../api.ts';
import type { ConfigUpdater } from '../config.ts';
import { issueFor } from '../config.ts';
import type { ValidationIssue } from '@shared/windows/validate.js';
import { Banner, Card, Details, Field, Select, TextInput, Toggle } from './ui.tsx';

export function EasyTab({
  config,
  update,
  catalog,
  issues,
}: {
  config: WindowsBuildConfig;
  update: ConfigUpdater;
  catalog: Catalog;
  issues: ValidationIssue[];
}) {
  const recommendedOn = recommendedPrivacyTweakIds.every((id) => config.privacy.includes(id));
  const editions = catalog.editions.filter((edition) => edition.availableIn.includes('win11-consumer'));

  return (
    <>
      <Card
        title="1. What you are installing"
        subtitle="The latest Windows 11 ISO is fetched straight from Microsoft when you start. Nothing is mirrored or modified beforehand."
      >
        <Field label="Language" hint="This sets the Windows display language and the ISO that gets downloaded.">
          <Select
            value={config.image.language}
            onChange={(language) => {
              const option = catalog.languages.find((l) => l.tag === language);
              update((draft) => {
                draft.image.language = language;
                draft.region.uiLanguage = language;
                draft.region.userLocale = language;
                if (option) draft.region.inputLocale = option.inputLocale;
              });
            }}
            options={catalog.languages.map((language) => ({ value: language.tag, label: language.label }))}
          />
        </Field>

        <Banner tone="info" title="One stick installs every edition">
          Windows Setup will ask which edition you want while it installs, so the same USB stick can put down{' '}
          {editions.map((e) => e.displayName.replace('Windows 11 ', '')).join(', ')}. Pick a fixed edition in the Advanced tab
          if you would rather not be asked.
        </Banner>
      </Card>

      <Card
        title="2. Your account"
        subtitle="Windows 11 normally forces you into a Microsoft account. This creates a local account instead, with the name you choose, and never asks."
      >
        <Field
          label="User name"
          hint="This is the account that will exist the moment Windows finishes installing."
          error={issueFor(issues, 'account.username')}
        >
          <TextInput
            value={config.account.username}
            onChange={(username) => update((draft) => { draft.account.username = username; })}
            placeholder="e.g. brian"
            maxLength={20}
          />
        </Field>

        <Field
          label="Password"
          hint="Leave blank for no password. The password is stored on the USB stick in a form anyone can reverse, so treat the stick as a secret."
          error={issueFor(issues, 'account.password')}
        >
          <TextInput
            value={config.account.password}
            onChange={(password) => update((draft) => { draft.account.password = password; })}
            type="password"
            autoComplete="new-password"
          />
        </Field>

        <Toggle
          checked={config.account.autoLogon}
          onChange={(autoLogon) => update((draft) => { draft.account.autoLogon = autoLogon; })}
          label="Sign in automatically the first time"
          description="Handy for a machine you are setting up on a bench. Turn it off for anything that leaves your desk."
        />
      </Card>

      <Card
        title="3. Privacy"
        subtitle="Applied once, at the end of setup, before you ever sign in. Nothing here disables Windows Update or Defender."
      >
        <Toggle
          checked={recommendedOn}
          onChange={(on) =>
            update((draft) => {
              draft.privacy = on ? [...recommendedPrivacyTweakIds] : [];
            })
          }
          label={`Apply the ${recommendedPrivacyTweakIds.length} recommended privacy settings`}
          description="Telemetry down to the minimum, no advertising ID, no Copilot or Recall, no web results in Start, location denied by default."
        />

        <Details summary="See exactly what changes">
          <ul className="tweak-list">
            {catalog.privacyTweaks
              .filter((tweak) => config.privacy.includes(tweak.id))
              .map((tweak) => (
                <li key={tweak.id}>
                  <strong>{tweak.label}</strong>
                  <span>{tweak.description}</span>
                  {tweak.tradeoff ? <em>Trade-off: {tweak.tradeoff}</em> : null}
                </li>
              ))}
          </ul>
        </Details>

        <Toggle
          checked={config.debloat.removeProvisionedApps}
          onChange={(on) => update((draft) => { draft.debloat.removeProvisionedApps = on; })}
          label={`Remove ${catalog.defaultPackages.length} preinstalled apps`}
          description="Xbox, Bing News, Solitaire, Teams and similar. The Store, Photos, Calculator, Terminal and the security stack are all left alone."
        />
      </Card>
    </>
  );
}
