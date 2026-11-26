# OS Installation Tool

Create a bootable **Linux** or **Windows 11** USB stick from Windows, macOS or Linux.
Windows media can include your local account, privacy settings and setup answers.

Two tabs:

- **Easy** answers four questions and uses safe defaults for everything else.
- **Advanced** exposes every option, including the destructive ones.

### Creating a Linux USB

**Windows desktop:** Double-click `OS-Installation-Tool.exe` and approve the Windows
administrator prompt. The portable app opens its own window with the USB writer
already connected; no browser, pairing code or installation is needed. Choose an
image and drive, review the erase warning, and confirm. The separate `osit-agent.exe`
is still available for the browser-based workflow.

The desktop setup screen keeps image selection, target, download retention and the
Create button together. Open **Windows settings** for account, edition and privacy
controls, **ISO options** for an existing Linux ISO, or **Review build plan** to
inspect the steps before confirming. Detailed dialogs can scroll independently;
press **Done** or **Esc** to return without losing your settings.
See the [tool family icon guide](docs/branding/README.md) for the editable artwork.

To build the desktop executable on Windows after building `packages/web`, run
`npm --prefix packages/desktop ci` and `npm --prefix packages/desktop run build`.
The portable x64 executable is written to `packages/desktop/dist/`. Each successful
desktop build replaces `_output/OS-Installation-Tool.exe` rather than accumulating
versioned copies. Close the previous app before building if Windows has it locked.

Select **Linux (x86-64)** and choose Ubuntu Desktop, Ubuntu Server, Linux Mint,
Fedora Workstation, Debian Live or Kali Installer. The helper downloads the selected
release through its official channel (including project-directed HTTPS mirrors), or
accepts a full path to a local copy of that exact ISO. It checks the published,
pinned SHA-256 before erasing anything. Only removable USB/SD drives are eligible.
**Which USB write mode should I pick?**

- **ISO files (recommended)** for Ubuntu Desktop on a Windows helper targeting
  an x64 UEFI PC, including Intel/AMD Surface models. The helper creates a GPT
  disk with one visible FAT32 volume, copies the Ubuntu files including the EFI
  bootloader, and verifies each copied file. The volume is capped at 32,000 MiB
  on larger drives. The helper checks file sizes and capacity *before* erasing;
  it never splits Linux files or silently switches modes.
- **Raw image (DD)** if you need the distribution's exact partition layout or
  want to try an alternative when file mode fails. The helper writes and reads
  back the image sector-for-sector. Windows may show multiple letters or no
  browsable files. This is the existing mode for all other catalog images and
  non-Windows hosts. Neither mode guarantees that a particular PC can run Ubuntu.
- **Signed GRUB + ISO (experimental)** for Ubuntu Desktop on x64 UEFI PCs,
  built from Windows without Ventoy. Use this to test an alternate boot path,
  not as a guaranteed Surface fix. Before erasing anything the helper fetches
  SHA-256-pinned Ubuntu archive packages, extracts the Microsoft-signed NX shim
  and Canonical-signed disk GRUB, and stages the verified ISO's kernel and initrd.
  The USB gets a 512 MiB FAT32 EFI partition with an app-generated GRUB menu
  and an NTFS data partition with the intact ISO. GRUB loads the kernel from FAT;
  Ubuntu's initramfs locates the ISO by its unique path. No key enrollment,
  firmware edits, or Secure Boot disablement are part of this workflow. A target
  that distrusts or has revoked a loader may refuse to boot; stop there rather
  than changing its trust settings. Rebuild the USB instead of replacing its ISO
  in Explorer: the boot partition's kernel and initrd must match.

The portable Windows helper is a single executable. Run it as Administrator, open
`http://127.0.0.1:5179`, choose an image and settings, then confirm **Create USB**.
Only then does it download the ISO to that PC. No installer, WSL, Node.js installation
or extra packages are needed. It creates standard media without persistence.

Desktop images let you try Linux without installing. Ubuntu Server and Kali Installer
start an installer instead. On Linux and macOS hosts, **Keep live-session changes** for Ubuntu Desktop adds
a 1 GiB unencrypted ext4 partition. This option requires `xorriso` and `mke2fs`
(e2fsprogs) on PATH.
Allow room for the downloaded ISO, a second image and the persistence partition
on the helper host. Select the USB in the test PC's one-time boot menu, choose
**Try Ubuntu**, save a file in your home folder and boot from the same USB again
to check persistence. Do not start the installer for this test.

## How Windows media is built

**Choosing between tools:** [balenaEtcher](https://etcher.balena.io/) is a good
fit for writing a ready-made disk image as-is and validating the flash. This
tool focuses on preparing an installer: official image selection, Windows setup
customization, and different Ubuntu USB layouts. Linux write verification checks
the media; it cannot certify that a particular computer will reach the desktop.
If creation fails, the progress screen identifies the stage that stopped and the
detailed log shows the preceding steps. A finished download isn't a finished USB.

1. Resolves the latest official Windows 11 ISO link from Microsoft's own download service.
2. Downloads it (resumable) to your machine. Nothing is mirrored, repackaged or redistributed.
3. Erases the USB stick and lays down a GPT + FAT32 layout that UEFI firmware can boot.
4. Copies the installer files, splitting `install.wim` into `install*.swm` so it fits on FAT32.
5. Writes `autounattend.xml` plus a `SetupComplete.cmd` that applies the privacy settings.
6. Deletes `sources/ei.cfg` so Windows Setup lets you pick Home, Pro, Education and the rest.

The result installs Windows without ever asking for a Microsoft account, a network connection,
a user name or a privacy choice.

By default it does stop at one screen, deliberately: **"Where do you want to install Windows?"**.
That is where you delete the old partitions to wipe the target drive and pick the unallocated
space. Nothing on the target PC is touched until you do. The app spells out these steps before
you build the stick and again when it finishes. If you would rather not be asked at all, the
Advanced tab can hand that decision to the answer file instead, which erases a whole disk with
no prompt.

## Why there is a local helper

A web page cannot partition, format or raw-write a disk. No browser API allows it, and that is
a good thing. So the tool is split in two:

| Part | Runs where | Does what |
| --- | --- | --- |
| Web app | Any browser, any OS. Static files only | Builds the answer file and the plan, entirely client side |
| Local helper | Your machine, elevated | Resolves the ISO link, downloads, partitions, formats, copies, injects |

Everything except the Microsoft download link is pure logic, so it runs in the browser. That has
three consequences worth knowing:

- The site is a plain static bundle, so it costs nothing to host and there is no backend to run.
- Your user name, password and Wi-Fi key never leave your machine. They go from the browser
  straight to the helper on `127.0.0.1`.
- The Microsoft request comes from *your* connection. Microsoft rate limits and blocks data
  centre IP ranges, so resolving from a hosted server is exactly the thing that gets refused.

The helper binds to `127.0.0.1` only, accepts pages from localhost and the official site and
nothing else, and requires a pairing code that it prints to its own console. The plan it
receives is re-validated before use, and any path that tries to escape the USB root is rejected.
Progress comes back over server-sent events, so the helper has no runtime dependencies at all.

`packages/server` is optional. It exists for self-hosting the API and is not needed by the
deployed site.

## What it leaves behind

Nothing, by default. The ISO is downloaded to `~/.osit/downloads`, used, and then deleted once
the stick is built, so a borrowed or shared machine is left as it was found. A **failed** run
keeps the partial file so the next attempt can resume instead of re-fetching 8.5 GB, and there
is a toggle to keep a successful download if you plan to make more than one stick.

The 8.5 GB has to pass through the computer either way. There is no route from Microsoft to a
USB stick that avoids the machine the stick is plugged into, in this or any other tool.

## Why this cannot be a pure web page

Worth stating plainly, because it is the first thing everyone asks. Hosting the page anywhere
else does not change any of it:

- **Browsers cannot format or partition a drive.** No web API exposes raw block devices.
  `showDirectoryPicker` writes files into an already-mounted volume; it cannot create a
  filesystem or make a disk bootable. WebUSB exists but mass storage is on its blocklist, which
  is exactly what stops any web page from wiping your disks.
- **A browser cannot even fetch the ISO.** Microsoft's download host sends no
  `Access-Control-Allow-Origin`, so the request is blocked by CORS. Proxying it would push
  8.5 GB per user through the proxy.
- **It would not fit.** Browser storage quota on a typical machine is around 7.5 GB, under the
  size of the ISO.

Hence the helper. It is small, it is auditable, and it only runs while you are using it.

## Using it

1. Open <https://bsantacruzms.github.io/os-installation-tool/>
2. Download the helper for your system when the page asks. One file, nothing to install.
3. Run it. It prints a pairing code.
4. Type that code into the page.

The helper needs Administrator on Windows, or `sudo` on macOS and Linux, because formatting a
drive does. On macOS and Linux, `chmod +x` it first; macOS will also want Right click > Open the
first time, because the binary is not notarised.

No internet, or a browser that refuses to talk to a local service? Open <http://127.0.0.1:5179>
instead. The helper carries the same interface inside it.

## Requirements

- Node.js 20.11 or newer.
- **Windows**: an Administrator terminal. `robocopy` and `dism` ship with Windows.
- **macOS**: `sudo`, plus `brew install wimlib`.
- **Linux**: `sudo`, plus `gdisk`, `dosfstools`, `rsync` and `wimtools`.
- A USB stick of 8 GB or more. Everything on it is destroyed.

## Building it yourself

```bash
npm run setup          # installs dependencies for every package
npm run build          # builds shared, agent and web

# the privileged helper (Administrator on Windows, sudo elsewhere)
npm run dev:agent
```

For UI work with hot reload, `npm run dev` starts Vite on port 5173.

```bash
npm test               # unit tests for the shared logic, the API and the agent
npm run typecheck      # strict type check across every package

# a single executable for the platform you are on
npm --prefix packages/agent run build:binary
```

The binary is built with Node's own single executable support, so there is no third-party
packer in the chain. It cannot be cross-compiled: each platform's binary is built on that
platform, which is what the release workflow's matrix is for. The web app is embedded into it at
build time, so the helper works with no files beside it and no network.

To check the live Microsoft download flow without writing anything:

```bash
cd packages/shared && npx tsx scripts/check-microsoft.ts
```

## Deployment

The web app is a static bundle with relative asset paths, so it works unchanged at a domain
root or at a subpath, and it can be hosted anywhere that serves files. There is no API to run.

### GitHub Pages

Live at <https://bsantacruzms.github.io/os-installation-tool/>.

`.github/workflows/pages.yml` builds and publishes on every push to `main` that touches the web
or shared packages. The shared tests gate the deploy. To move it onto a custom domain, set a
`PAGES_DOMAIN` repository variable and add a `CNAME` record pointing at `bsantacruzms.github.io`.
On Cloudflare the record must be **DNS only** (grey cloud), at least until GitHub has issued the
certificate, or verification fails and "Enforce HTTPS" stays greyed out.

### Your own server

Because it is only static files, any existing web server can host it. That is usually simpler
than moving DNS, since it leaves whatever else lives on the domain alone.

```bash
./deploy/publish.sh root@os.brionicx.com:/var/www/osit
```

`deploy/nginx/osit.conf` is a ready nginx server block with the right cache headers and a
Content-Security-Policy that permits the one cross-origin call the page makes, to the helper on
`127.0.0.1:5179`.

For automatic deploys, `.github/workflows/droplet.yml` rsyncs the build on every push. It skips
cleanly when the secrets are absent, so it never blocks anything. Set:

| Secret | Meaning |
| --- | --- |
| `DROPLET_HOST` | Hostname or IP |
| `DROPLET_USER` | SSH user |
| `DROPLET_PATH` | Web root, e.g. `/var/www/osit` |
| `DROPLET_SSH_KEY` | Private key for that user |
| `DROPLET_KNOWN_HOSTS` | Output of `ssh-keyscan <host>`, so the upload cannot be redirected |
| `DROPLET_SSH_PORT` | Optional, defaults to 22 |

### Whichever host you use

Add the origin to `OFFICIAL_ORIGINS` in `packages/agent/src/security.ts`, or the helper will
refuse to talk to the page. `https://os.brionicx.com` and `https://bsantacruzms.github.io` are
already there.

## Layout

```
packages/
  shared/   pure logic: answer file, privacy tweaks, editions, validation, build plan,
            plus the Microsoft download resolver
  agent/    local helper: device enumeration, download, partition, format, copy, inject
  web/      React UI with the Easy and Advanced tabs, deployed as static files
  server/   optional: self-hosted API, not used by the deployed site
```

`packages/shared` has no dependencies and no I/O, so the part that decides what lands on the
stick is fully unit tested.

## Safety

- The disk this computer boots from is never offered and never written, whatever the settings.
- Non-removable disks are hidden unless you deliberately turn the safety check off.
- The confirmation step names the drive and its size before anything is erased.
- Automatic partitioning of the **target PC's** disk is off by default. Turning it on is a
  separate, clearly labelled choice in the Advanced tab.

## Licensing and Windows activation

The generic setup keys used for edition pre-selection are Microsoft's own published values.
They tell Setup which edition to install; they do not activate Windows and they are not a
licence. You still need a valid Windows licence.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `OSIT_PORT` | `5178` | API and web app port |
| `OSIT_HOST` | `127.0.0.1` | API bind address |
| `OSIT_AGENT_PORT` | `5179` | Agent port |
| `OSIT_AGENT_CODE` | random | Fixed pairing code, useful for scripting |
| `OSIT_AGENT_WORKDIR` | `~/.osit/downloads` | Where ISOs are cached |
