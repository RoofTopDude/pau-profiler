/**
 * Small deterministic non-cryptographic content fingerprint (FNV-1a 64-bit).
 * Callers may supply cryptographic contentHash values when stronger provenance is required.
 */
export function fingerprint(text: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (const char of text) {
    hash ^= BigInt(char.codePointAt(0) ?? 0);
    hash = BigInt.asUintN(64, hash * prime);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}
