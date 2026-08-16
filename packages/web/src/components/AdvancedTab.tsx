import type { Arch, WindowsBuildConfig } from '@shared/types.js';
import type { ValidationIssue } from '@shared/windows/validate.js';
import type { Catalog } from '../api.ts';
import type { ConfigUpdater } from '../config.ts';
import { issueFor } from '../config.ts';
import { Banner, Card, Details, Field, Select, TextInput, Toggle } from './ui.tsx';

const TIME_ZONES = [
  '',
  'UTC',
  'Pacific Standard Time',
  'Mountain Standard Time',
  'Central Standard Time',
  'Eastern Standard Time',
  'GMT Standard Time',
  'W. Europe Standard Time',
  'Central Europe Standard Time',
  'Romance Standard Time',
  'India Standard Time',
  'China Standard Time',
  'Tokyo Standard Time',
  'AUS Eastern Standard Time',
];

export function AdvancedTab({
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
  const variant = catalog.images.find((image) => image.id === config.image.variantId);
  const editions = catalog.editions.filter(
    (edition) => edition.availableIn.includes(config.image.variantId) && edition.arches.includes(config.image.arch),
  );
  const categories = [...new Set(catalog.privacyTweaks.map((tweak) => tweak.category))];

  return (
    <>
      <Card title="Image" subtitle="Where the installer comes from and which architecture it targets.">
        <Field label="Image">
          <Select
            value={config.image.variantId}
            onChange={(variantId) =>
              update((draft) => {
                draft.image.variantId = variantId;
                draft.image.edition = { kind: 'ask-at-install' };
              })
            }
            options={catalog.images.map((image) => ({
              value: image.id,
              // Only the consumer ISO can be resolved automatically so far.
              // Listing the rest as choosable would silently fetch the wrong one.
              label: image.source === 'microsoft-download-api' ? image.name : `${image.name} - not supported yet`,
              disabled: image.source !== 'microsoft-download-api',
            }))}
          />
        </Field>
        {variant && variant.source !== 'microsoft-download-api' ? (
          <Banner tone="warning" title="Not wired up yet">
            This image cannot be fetched automatically. Microsoft puts the evaluation builds behind a registration form, and
            choosing your own ISO needs a file picker that does not exist yet. Only the consumer ISO works today.
          </Banner>
        ) : null}
        {variant ? <p className="muted">{variant.description}</p> : null}
        {variant?.notes?.map((note) => (
          <Banner key={note} tone="info">
            {note}
          </Banner>
        ))}

        <Field label="Architecture" hint="x64 for every normal PC. arm64 only for Snapdragon and similar ARM machines.">
          <Select<Arch>
            value={config.image.arch}
            onChange={(arch) => update((draft) => { draft.image.arch = arch; })}
            options={[
              { value: 'x64', label: 'x64 (Intel and AMD)' },
              { value: 'arm64', label: 'arm64 (ARM based PCs)' },
            ]}
          />
        </Field>

        <Field label="Language">
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

        <Field
          label="Edition"
          hint="Choosing at install time keeps ei.cfg off the stick so Setup shows the picker. Pre-selecting uses Microsoft's public generic setup key, which selects the edition but does not activate Windows."
          error={issueFor(issues, 'image.edition')}
        >
          <Select
            value={config.image.edition.kind === 'preselect' ? config.image.edition.editionId : ''}
            onChange={(editionId) =>
              update((draft) => {
                draft.image.edition = editionId === '' ? { kind: 'ask-at-install' } : { kind: 'preselect', editionId };
              })
            }
            options={[
              { value: '', label: 'Ask me while installing' },
              ...editions.map((edition) => ({ value: edition.id, label: edition.displayName })),
            ]}
          />
        </Field>
      </Card>

      <Card title="Account">
        <Field label="User name" error={issueFor(issues, 'account.username')}>
          <TextInput
            value={config.account.username}
            onChange={(username) => update((draft) => { draft.account.username = username; })}
            maxLength={20}
          />
        </Field>
        <Field label="Password" error={issueFor(issues, 'account.password')}>
          <TextInput
            value={config.account.password}
            onChange={(password) => update((draft) => { draft.account.password = password; })}
            type="password"
            autoComplete="new-password"
          />
        </Field>
        <Toggle
          checked={config.account.administrator}
          onChange={(on) => update((draft) => { draft.account.administrator = on; })}
          label="Make it an administrator"
          description="Turn this off and the account lands in Users instead. You will need another way in to change system settings."
        />
        <Toggle
          checked={config.account.autoLogon}
          onChange={(on) => update((draft) => { draft.account.autoLogon = on; })}
          label="Sign in automatically"
        />
        {config.account.autoLogon ? (
          <Field label="Number of automatic sign-ins">
            <TextInput
              value={String(config.account.autoLogonCount)}
              onChange={(value) => update((draft) => { draft.account.autoLogonCount = Math.max(1, Number(value) || 1); })}
            />
          </Field>
        ) : null}
        <Toggle
          checked={config.account.skipSecurityQuestions}
          onChange={(on) => update((draft) => { draft.account.skipSecurityQuestions = on; })}
          label="Skip the password reset security questions"
        />
      </Card>

      <Card title="Setup behaviour">
        <Field label="PC name" hint="Leave blank to let Windows generate one. Must differ from the user name." error={issueFor(issues, 'setup.computerName')}>
          <TextInput
            value={config.setup.computerName}
            onChange={(name) => update((draft) => { draft.setup.computerName = name; })}
            placeholder="e.g. WORKSHOP-01"
            maxLength={15}
          />
        </Field>

        <Toggle
          checked={config.setup.skipMicrosoftAccount}
          onChange={(on) => update((draft) => { draft.setup.skipMicrosoftAccount = on; })}
          label="Never ask for a Microsoft account"
        />
        <Toggle
          checked={config.setup.bypassNetworkRequirement}
          onChange={(on) => update((draft) => { draft.setup.bypassNetworkRequirement = on; })}
          label="Let setup finish without a network connection"
        />
        <Toggle
          checked={config.setup.disableExpressSettings}
          onChange={(on) => update((draft) => { draft.setup.disableExpressSettings = on; })}
          label="Decline the express privacy settings"
        />
        <Toggle
          checked={config.setup.bypassRequirements}
          onChange={(on) => update((draft) => { draft.setup.bypassRequirements = on; })}
          label="Install on unsupported hardware"
          description="Adds the documented registry shims for TPM 2.0, Secure Boot, RAM, storage and CPU checks."
          tradeoff="Microsoft does not guarantee updates on a PC that fails the official requirements."
        />

        <Field label="Region" hint="Time zone is optional; leave it unset to keep the Windows default.">
          <Select
            value={config.region.timeZone}
            onChange={(timeZone) => update((draft) => { draft.region.timeZone = timeZone; })}
            options={TIME_ZONES.map((zone) => ({ value: zone, label: zone === '' ? 'Let Windows decide' : zone }))}
          />
        </Field>

        <Field label="Keyboard layout" hint="Windows layout id pair, for example 0409:00000409.">
          <TextInput
            value={config.region.inputLocale}
            onChange={(inputLocale) => update((draft) => { draft.region.inputLocale = inputLocale; })}
          />
        </Field>
      </Card>

      <Card title="Target disk" tone={config.setup.disk.kind === 'wipe-disk' ? 'danger' : 'default'}>
        <Field
          label="How the disk in the target PC is handled"
          hint="This is about the computer you install onto, not the USB stick."
        >
          <Select
            value={config.setup.disk.kind}
            onChange={(kind) =>
              update((draft) => {
                draft.setup.disk = kind === 'wipe-disk' ? { kind: 'wipe-disk', diskId: 0, recoveryPartitionMb: 750 } : { kind: 'interactive' };
              })
            }
            options={[
              { value: 'interactive', label: 'Let me choose during setup (safe)' },
              { value: 'wipe-disk', label: 'Erase a whole disk automatically (destructive)' },
            ]}
          />
        </Field>

        {config.setup.disk.kind === 'wipe-disk' ? (
          <>
            <Banner tone="danger" title="This erases everything">
              Every partition on the chosen disk of the target PC is destroyed without a further prompt, including any other
              operating system on it. Disk 0 is usually, but not always, the first internal drive.
            </Banner>
            <Field label="Disk number" error={issueFor(issues, 'setup.disk')}>
              <TextInput
                value={String(config.setup.disk.diskId)}
                onChange={(value) =>
                  update((draft) => {
                    if (draft.setup.disk.kind === 'wipe-disk') draft.setup.disk.diskId = Math.max(0, Number(value) || 0);
                  })
                }
              />
            </Field>
            <Field label="Recovery partition size in MB" hint="Set to 0 to skip the recovery partition entirely.">
              <TextInput
                value={String(config.setup.disk.recoveryPartitionMb)}
                onChange={(value) =>
                  update((draft) => {
                    if (draft.setup.disk.kind === 'wipe-disk') draft.setup.disk.recoveryPartitionMb = Math.max(0, Number(value) || 0);
                  })
                }
              />
            </Field>
          </>
        ) : null}
      </Card>

      <Card title="Wi-Fi" subtitle="Optional. Lets a machine with no Ethernet get online by itself after the first sign-in.">
        <Toggle
          checked={config.wifi.enabled}
          onChange={(on) => update((draft) => { draft.wifi.enabled = on; })}
          label="Join a Wi-Fi network automatically"
          tradeoff="The passphrase is stored on the USB stick in clear text."
        />
        {config.wifi.enabled ? (
          <>
            <Field label="Network name" error={issueFor(issues, 'wifi.ssid')}>
              <TextInput value={config.wifi.ssid} onChange={(ssid) => update((draft) => { draft.wifi.ssid = ssid; })} />
            </Field>
            <Field label="Passphrase" hint="8 to 63 characters. Leave blank for an open network." error={issueFor(issues, 'wifi.password')}>
              <TextInput
                value={config.wifi.password}
                onChange={(password) => update((draft) => { draft.wifi.password = password; })}
                type="password"
                autoComplete="new-password"
              />
            </Field>
            <Toggle
              checked={config.wifi.hidden}
              onChange={(on) => update((draft) => { draft.wifi.hidden = on; })}
              label="This network does not broadcast its name"
            />
          </>
        ) : null}
      </Card>

      <Card title="Privacy" subtitle="Each of these maps to a documented Windows policy or setting. Hover the description to see exactly what changes.">
        {categories.map((category) => (
          <div key={category} className="tweak-group">
            <h3>{category}</h3>
            {catalog.privacyTweaks
              .filter((tweak) => tweak.category === category)
              .map((tweak) => (
                <Toggle
                  key={tweak.id}
                  checked={config.privacy.includes(tweak.id)}
                  onChange={(on) =>
                    update((draft) => {
                      draft.privacy = on ? [...new Set([...draft.privacy, tweak.id])] : draft.privacy.filter((id) => id !== tweak.id);
                    })
                  }
                  label={tweak.label}
                  description={tweak.description}
                  {...(tweak.tradeoff ? { tradeoff: tweak.tradeoff } : {})}
                />
              ))}
          </div>
        ))}
      </Card>

      <Card title="Preinstalled apps">
        <Toggle
          checked={config.debloat.removeProvisionedApps}
          onChange={(on) => update((draft) => { draft.debloat.removeProvisionedApps = on; })}
          label="Remove the apps listed below"
        />
        <Toggle
          checked={config.debloat.disableOneDriveSetup}
          onChange={(on) => update((draft) => { draft.debloat.disableOneDriveSetup = on; })}
          label="Do not run OneDrive setup at first sign-in"
        />
        <Details summary={`Edit the list (${config.debloat.packages.length} packages)`}>
          <textarea
            className="input input--code"
            rows={12}
            value={config.debloat.packages.join('\n')}
            onChange={(event) =>
              update((draft) => {
                draft.debloat.packages = event.target.value
                  .split('\n')
                  .map((line) => line.trim())
                  .filter((line) => line.length > 0);
              })
            }
          />
          <p className="muted">One package family name per line. Unknown names are simply skipped during setup.</p>
        </Details>
      </Card>

      <Card title="Extra commands" subtitle="Run once as SYSTEM at the end of setup. One command per line.">
        <textarea
          className="input input--code"
          rows={5}
          value={config.extraSetupCommands.join('\n')}
          onChange={(event) =>
            update((draft) => {
              draft.extraSetupCommands = event.target.value
                .split('\n')
                .map((line) => line.trim())
                .filter((line) => line.length > 0);
            })
          }
          placeholder={'powershell.exe -Command "Set-TimeZone -Id \'UTC\'"'}
        />
        <Banner tone="warning">
          These run with full system privileges on every PC you install with this stick. Only put in commands you have read and
          understand.
        </Banner>
      </Card>
    </>
  );
}
