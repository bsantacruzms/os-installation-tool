# OS Installation Tool

Create a bootable **Windows 11** USB stick from Windows, macOS or Linux, with the local
account, the privacy settings and every setup answer already filled in.

Two tabs:

- **Easy** answers four questions and uses safe defaults for everything else.
- **Advanced** exposes every option, including the destructive ones.

Linux distributions are next; the catalog and plan model are already family-aware.

## What it actually does

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
| Local agent | Your machine, elevated | Resolves the ISO link, downloads, partitions, formats, copies, injects |

Everything except the Microsoft download link is pure logic, so it runs in the browser. That has
three consequences worth knowing:

- The site is a plain static bundle, so it costs nothing to host and there is no backend to run.
- Your user name, password and Wi-Fi key never leave your machine. They go from the browser
  straight to the helper on `127.0.0.1`.
- The Microsoft request comes from *your* connection. Microsoft rate limits and blocks data
  centre IP ranges, so resolving from a hosted server is exactly the thing that gets refused.

The agent binds to `127.0.0.1` only, accepts pages from localhost and `https://os.brionicx.com`
and nothing else, and requires a pairing code that it prints to its own console. The plan it
receives is re-validated before use, and any path that tries to escape the USB root is rejected.

The agent also serves the same web app on `http://127.0.0.1:5179`, so the tool still works with
no internet connection and in browsers that refuse to let an https page talk to a plain http
localhost service.

`packages/server` is optional. It exists for self-hosting the API and is not needed by the
deployed site.

## Requirements

- Node.js 20.11 or newer.
- **Windows**: an Administrator terminal. `robocopy` and `dism` ship with Windows.
- **macOS**: `sudo`, plus `brew install wimlib`.
- **Linux**: `sudo`, plus `gdisk`, `dosfstools`, `rsync` and `wimtools`.
- A USB stick of 8 GB or more. Everything on it is destroyed.

## Running it

```bash
npm run setup          # installs dependencies for every package
npm run build          # builds shared, server, agent and web

# the privileged helper (Administrator on Windows, sudo elsewhere)
npm run dev:agent
```

The agent prints a pairing code. Then either:

- open <https://os.brionicx.com> and enter the code, or
- open <http://127.0.0.1:5179>, which the agent serves itself.

For UI work with hot reload, `npm run dev` starts Vite on port 5173.

```bash
npm test               # unit tests for the shared logic, the API and the agent
npm run typecheck      # strict type check across every package
```

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
