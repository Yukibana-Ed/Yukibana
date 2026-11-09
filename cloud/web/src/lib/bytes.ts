/** Small things about bytes that more than one module needs. */

/** Returns `bytes` as lowercase hexadecimal, two digits per byte, with no
 *  prefix or separator; '' for no bytes. */
export function hex(bytes: Uint8Array): string {
    let out = '';
    for (const b of bytes) out += b.toString(16).padStart(2, '0');
    return out;
}

/** Returns the bytes `text` spells in hexadecimal, two digits per byte, in
 *  either case: the inverse of `hex`.
 *
 *  - Requires: `text` is an even number of hexadecimal digits and nothing
 *    else; throws a RangeError otherwise. (It used to answer an odd length by
 *    dropping the last digit and a non-digit by a zero byte, without a word.) */
export function fromHex(text: string): Uint8Array {
    if (!/^(?:[0-9a-fA-F]{2})*$/.test(text)) throw new RangeError('fromHex: not an even number of hexadecimal digits');
    const out = new Uint8Array(text.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(text.slice(2 * i, 2 * i + 2), 16);
    return out;
}

/** Returns the SHA-256 digest of `bytes`, 32 bytes. Reads only the view's
 *  own range, not the rest of a larger buffer it may sit in. */
export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
}

/** `true` iff `a` and `b` hold the same bytes. For equal lengths the time
 *  taken does not depend on where they differ, so it is safe for comparing
 *  a signature or a digest; a difference in length answers at once, which
 *  tells a guesser only the length, and that is not secret. */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
    return diff === 0;
}

/** `true` iff these bytes begin a gzip member, as every archive must.
 *
 *  The registry never opens an archive: this check is all it does, and
 *  whoever grades a submission opens it. */
export function isGzip(bytes: Uint8Array): boolean {
    return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}
