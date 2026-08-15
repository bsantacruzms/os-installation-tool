import type { BuildPlan, InjectedFile, RemovedPath, WindowsBuildConfig } from '../types.js';
import { findEdition, editionsForVariant } from './editions.js';
import { findPrivacyTweak } from './privacy.js';
import { buildDebloatScript, buildSetupCompleteScript } from './scripts.js';
import { buildAutounattendXml, buildWifiProfileXml } from './unattend.js';

/** Copied to `%WINDIR%` by Windows Setup. */
const OEM_SCRIPTS = 'sources/$OEM$/$$/Setup/Scripts';
/** Plain copy at the root of the stick, used by the specialize-pass fallback. */
const USB_SCRIPTS = 'OSIT';

function bothLocations(name: string, content: string, purpose: string): InjectedFile[] {
  return [
    { path: `${OEM_SCRIPTS}/${name}`, content, encoding: 'utf8', purpose },
    { path: `${USB_SCRIPTS}/${name}`, content, encoding: 'utf8', purpose: `${purpose} (media fallback copy)` },
  ];
}

/**
 * The walkthrough shown to whoever ends up in front of the target PC. It has to
 * match the plan exactly: if automatic partitioning is off, the drive screen
 * really will appear and they really do have to clear the old partitions there.
 */
function buildBootSteps(config: WindowsBuildConfig): string[] {
  const steps: string[] = [
    'Plug the stick into the PC you want to install on and boot from it. The one-off boot menu is usually F12, F11, F9, Esc or Del, depending on the make.',
  ];

  if (config.image.edition.kind === 'ask-at-install') {
    steps.push('Pick the edition you want when Setup asks. If it wants a product key, choose "I don\'t have a product key"; you can activate later.');
  }

  if (config.setup.disk.kind === 'wipe-disk') {
    steps.push(
      `Setup erases disk ${config.setup.disk.diskId} and partitions it on its own. You are not asked, and there is no chance to change your mind here.`,
    );
  } else {
    steps.push(
      'At "Where do you want to install Windows?", delete every partition on the drive you are installing to. That clears the old system off it.',
    );
    steps.push('Then select the single block of unallocated space that is left and continue. Setup builds the correct partition layout by itself.');
  }

  steps.push('From there it runs unattended: no Microsoft account, no network prompt, no privacy questions and no name to type in.');

  const username = config.account.username.trim();
  if (username.length > 0) {
    steps.push(
      config.account.autoLogon
        ? `Windows restarts and signs straight into "${username}".`
        : `Windows restarts and waits at the sign-in screen for "${username}".`,
    );
  }

  return steps;
}

/**
 * Turns a validated configuration into the exact set of file changes the agent
 * must apply to the extracted ISO. Pure and deterministic, so the UI can show
 * the user precisely what will land on the stick before anything is written.
 */
export function buildWindowsPlan(config: WindowsBuildConfig): BuildPlan {
  const injectedFiles: InjectedFile[] = [];
  const removedPaths: RemovedPath[] = [];
  const summary: string[] = [];
  const warnings: string[] = [];

  injectedFiles.push({
    path: 'autounattend.xml',
    content: buildAutounattendXml(config),
    encoding: 'utf8',
    purpose: 'Answers every Windows Setup and OOBE question automatically',
  });

  const setupComplete = buildSetupCompleteScript(config);
  injectedFiles.push(...bothLocations('SetupComplete.cmd', setupComplete, 'Applies privacy and cleanup settings at the end of setup'));

  const debloat = buildDebloatScript(config);
  if (debloat) {
    injectedFiles.push(...bothLocations('Debloat.ps1', debloat, 'Removes preinstalled Store apps'));
  }

  if (config.wifi.enabled && config.wifi.ssid.trim().length > 0) {
    const profile = buildWifiProfileXml(config.wifi.ssid.trim(), config.wifi.password, config.wifi.hidden);
    injectedFiles.push(...bothLocations('wifi.xml', profile, 'Joins the pre-configured Wi-Fi network on first sign-in'));
    warnings.push('The Wi-Fi passphrase is stored unencrypted on the USB stick.');
  }

  if (config.image.edition.kind === 'ask-at-install') {
    removedPaths.push({
      path: 'sources/ei.cfg',
      purpose: 'Lets Windows Setup show the edition picker instead of forcing one edition',
    });
    const available = editionsForVariant(config.image.variantId, config.image.arch);
    summary.push(
      available.length > 0
        ? `Edition is chosen during installation. This image offers: ${available.map((e) => e.displayName).join(', ')}.`
        : 'Edition is chosen during installation.',
    );
  } else {
    const edition = findEdition(config.image.edition.editionId);
    summary.push(`Installs ${edition?.displayName ?? config.image.edition.editionId} without asking.`);
    summary.push('Uses the public generic setup key for that edition. It selects the edition only, it does not activate Windows.');
  }

  const username = config.account.username.trim();
  if (username.length > 0) {
    summary.push(
      `Creates the local ${config.account.administrator ? 'administrator' : 'standard'} account "${username}"${
        config.account.password.length > 0 ? ' with the password you entered' : ' with no password'
      }.`,
    );
  }
  if (config.account.autoLogon) summary.push('Signs that account in automatically after the first boot.');
  if (config.setup.skipMicrosoftAccount) summary.push('Never asks for a Microsoft account during setup.');
  if (config.setup.bypassNetworkRequirement) summary.push('Lets setup finish with no network connection.');
  if (config.setup.bypassRequirements) summary.push('Installs on PCs without TPM 2.0, Secure Boot or a supported CPU.');
  if (config.setup.disableExpressSettings) summary.push('Declines the express privacy settings during OOBE.');

  const region: string[] = [];
  if (config.region.uiLanguage) region.push(`language ${config.region.uiLanguage}`);
  if (config.region.timeZone) region.push(`time zone ${config.region.timeZone}`);
  if (region.length > 0) summary.push(`Presets ${region.join(', ')}.`);

  const tweaks = config.privacy.map(findPrivacyTweak).filter((t): t is NonNullable<typeof t> => t !== undefined);
  if (tweaks.length > 0) summary.push(`Applies ${tweaks.length} privacy settings: ${tweaks.map((t) => t.label).join('; ')}.`);

  if (config.debloat.removeProvisionedApps && config.debloat.packages.length > 0) {
    summary.push(`Removes ${config.debloat.packages.length} preinstalled apps.`);
  }

  if (config.setup.disk.kind === 'wipe-disk') {
    summary.push(`Erases disk ${config.setup.disk.diskId} on the target PC and partitions it automatically.`);
    warnings.push(
      `Everything on disk ${config.setup.disk.diskId} of the PC you install to will be destroyed with no further prompt.`,
    );
  } else {
    summary.push("Stops at Windows Setup's drive screen so you can delete the old partitions and choose where to install.");
  }

  if (config.account.password.length === 0 && username.length > 0) {
    warnings.push('The new account has no password, so anyone who can reach the PC can sign in.');
  }
  if (config.account.password.length > 0) {
    warnings.push('The account password is stored on the USB stick in an easily reversible form. Treat the stick as a secret.');
  }
  if (config.setup.bypassRequirements) {
    warnings.push('Microsoft does not guarantee updates for Windows 11 installed on unsupported hardware.');
  }

  return { injectedFiles, removedPaths, summary, bootSteps: buildBootSteps(config), warnings };
}
