import { verifyKey } from 'discord-interactions';

/**
 * Verify that an incoming request is genuinely from Discord.
 * Discord signs every request with Ed25519 using your app's public key.
 * You MUST return HTTP 401 for invalid signatures — Discord will reject
 * your endpoint if it doesn't properly validate.
 *
 * We pre-import the CryptoKey ourselves because discord-interactions v4
 * passes `namedCurve: 'ed25519'` to importKey(), which CF Workers' Ed25519
 * implementation rejects. Passing a CryptoKey directly to verifyKey() skips
 * the package's broken importKey call and goes straight to verify().
 */
export async function verifyDiscordRequest(request: Request, publicKey: string): Promise<{ valid: boolean; body: string }> {
	const signature = request.headers.get('X-Signature-Ed25519');
	const timestamp = request.headers.get('X-Signature-Timestamp');

	if (!signature || !timestamp) {
		return { valid: false, body: '' };
	}

	const body = await request.text();

	try {
		const cryptoKey = await crypto.subtle.importKey(
			'raw',
			hexToBytes(publicKey),
			{ name: 'Ed25519' },
			false,
			['verify']
		);

		// Cast to `any` because verifyKey's TS types only declare string | Buffer,
		// but the runtime accepts a CryptoKey and skips its own importKey step.
		const valid = await verifyKey(body, signature, timestamp, cryptoKey as any);
		return { valid, body };
	} catch (err) {
		console.error('Signature verification error:', err);
		return { valid: false, body };
	}
}

function hexToBytes(hex: string): Uint8Array {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	return bytes;
}
