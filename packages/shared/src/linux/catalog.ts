/**
 * Pinned official images and their published SHA-256 digests. A new release
 * must update both the URL and digest together; a checksum mismatch must never
 * be treated as a successful download.
 */
export interface LinuxImage {
  id: string;
  name: string;
  url: string;
  fileName: string;
  sha256: string;
  checksumUrl: string;
  live: boolean;
}

export const linuxImages: readonly LinuxImage[] = [
  {
    id: 'ubuntu-desktop',
    name: 'Ubuntu Desktop 26.04.1 LTS',
    url: 'https://releases.ubuntu.com/26.04/ubuntu-26.04.1-desktop-amd64.iso',
    fileName: 'ubuntu-26.04.1-desktop-amd64.iso',
    sha256: '601e30fbf5d97759367c632e2c33630665039b7e2158fd068403da3ccf1bda1f',
    checksumUrl: 'https://releases.ubuntu.com/26.04/SHA256SUMS',
    live: true,
  },
  {
    id: 'ubuntu-server',
    name: 'Ubuntu Server 26.04.1 LTS',
    url: 'https://releases.ubuntu.com/26.04/ubuntu-26.04.1-live-server-amd64.iso',
    fileName: 'ubuntu-26.04.1-live-server-amd64.iso',
    sha256: 'cc8a95cde20f6ced61a322420de00f10cc3c90ced545daa46cb9c1a117f1d927',
    checksumUrl: 'https://releases.ubuntu.com/26.04/SHA256SUMS',
    live: false,
  },
  {
    id: 'linux-mint',
    name: 'Linux Mint 22.3 Cinnamon',
    url: 'https://pub.linuxmint.io/stable/22.3/linuxmint-22.3-cinnamon-64bit.iso',
    fileName: 'linuxmint-22.3-cinnamon-64bit.iso',
    sha256: 'a081ab202cfda17f6924128dbd2de8b63518ac0531bcfe3f1a1b88097c459bd4',
    checksumUrl: 'https://pub.linuxmint.io/stable/22.3/sha256sum.txt',
    live: true,
  },
  {
    id: 'fedora-workstation',
    name: 'Fedora Workstation 45',
    url: 'https://download.fedoraproject.org/pub/fedora/linux/releases/45/Workstation/x86_64/iso/Fedora-Workstation-Live-45-1.4.x86_64.iso',
    fileName: 'Fedora-Workstation-Live-45-1.4.x86_64.iso',
    sha256: '68338c6bfe4f0d64151f2e47efe9f44a8855ad05b460e56b844fb3fa2c9a3beb',
    checksumUrl: 'https://dl.fedoraproject.org/pub/fedora/linux/releases/45/Workstation/x86_64/iso/Fedora-Workstation-45-1.4-x86_64-CHECKSUM',
    live: true,
  },
  {
    id: 'debian-live',
    name: 'Debian Live 13.8.0 GNOME',
    url: 'https://cdimage.debian.org/debian-cd/current-live/amd64/iso-hybrid/debian-live-13.8.0-amd64-gnome.iso',
    fileName: 'debian-live-13.8.0-amd64-gnome.iso',
    sha256: '2135003cc5d324312720ab26161c1546b5e0a1a382d5e1a18bf0092bdeb7ff9c',
    checksumUrl: 'https://cdimage.debian.org/debian-cd/current-live/amd64/iso-hybrid/SHA256SUMS',
    live: true,
  },
  {
    id: 'kali-installer',
    name: 'Kali Linux 2026.3 Installer',
    url: 'https://cdimage.kali.org/kali-2026.3/kali-linux-2026.3-installer-amd64.iso',
    fileName: 'kali-linux-2026.3-installer-amd64.iso',
    sha256: 'db9cbed33edb45727d16911813c2434fcd1419585007884153be22a03b30ec2f',
    checksumUrl: 'https://cdimage.kali.org/kali-2026.3/SHA256SUMS',
    live: false,
  },
];

export function findLinuxImage(id: string): LinuxImage | undefined {
  return linuxImages.find((image) => image.id === id);
}
