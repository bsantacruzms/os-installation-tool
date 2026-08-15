/** Base64 without depending on Buffer or atob, so this module runs anywhere. */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64FromBytes(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    const triple = (b0 << 16) | ((b1 ?? 0) << 8) | (b2 ?? 0);
    out += B64[(triple >> 18) & 63];
    out += B64[(triple >> 12) & 63];
    out += b1 === undefined ? '=' : B64[(triple >> 6) & 63];
    out += b2 === undefined ? '=' : B64[triple & 63];
  }
  return out;
}

export function utf16leBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    bytes[i * 2] = code & 0xff;
    bytes[i * 2 + 1] = code >> 8;
  }
  return bytes;
}

/**
 * Windows unattend files store passwords as base64 of UTF-16LE text with the
 * name of the containing element appended. This is obfuscation, not encryption:
 * anyone holding the USB stick can trivially recover the password.
 */
export function obfuscatePassword(password: string, elementName: 'Password' | 'AdministratorPassword'): string {
  return base64FromBytes(utf16leBytes(password + elementName));
}
