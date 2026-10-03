const encoder = new TextEncoder();

type SubtleWithTimingSafeEqual = { timingSafeEqual?: (a: ArrayBufferView, b: ArrayBufferView) => boolean };

/**
 * Compares two strings in time that does not depend on where they differ.
 * Uses crypto.subtle.timingSafeEqual where the runtime has it (Cloudflare
 * Workers) and a constant-time byte loop elsewhere (Node, used by the tests and
 * scripts/serve-local.ts). Only the length can leak, which is fine for a secret
 * of fixed length.
 */
export function timingSafeEqualStrings(a: string, b: string): boolean {
	const aBytes = encoder.encode(a);
	const bBytes = encoder.encode(b);
	const sameLength = aBytes.byteLength === bBytes.byteLength;
	// Always compare two buffers of equal length; on a length mismatch compare a with itself and report false.
	const other = sameLength ? bBytes : aBytes;

	const subtle = (typeof crypto === 'undefined' ? undefined : crypto.subtle) as SubtleWithTimingSafeEqual | undefined;
	let equal: boolean;
	if (typeof subtle?.timingSafeEqual === 'function') {
		equal = subtle.timingSafeEqual(aBytes, other);
	} else {
		let diff = 0;
		for (let i = 0; i < aBytes.byteLength; i++) diff |= aBytes[i] ^ other[i];
		equal = diff === 0;
	}
	return sameLength && equal;
}

/**
 * True when BOT_API_KEY is configured and the X-Bot-Token header value equals
 * it. Never true when the key is unset or empty.
 */
export function isValidBotToken(key: string | undefined, token: string | undefined | null): boolean {
	if (!key || !token) return false;
	return timingSafeEqualStrings(token, key);
}
