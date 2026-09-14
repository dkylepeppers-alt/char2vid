/** SHA-256 hex digest via Web Crypto (Node 24+ and browsers). */
export async function sha256HexAsync(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    bytes.slice(),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
