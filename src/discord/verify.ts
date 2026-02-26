import { verifyKey } from 'discord-interactions';

/**
 * Verify that an incoming request is genuinely from Discord.
 * Discord signs every request with Ed25519 using your app's public key.
 * You MUST return HTTP 401 for invalid signatures — Discord will reject
 * your endpoint if it doesn't properly validate.
 */
export async function verifyDiscordRequest(request: Request, publicKey: string): Promise<{ valid: boolean; body: string }> {
	const signature = request.headers.get('X-Signature-Ed25519');
	const timestamp = request.headers.get('X-Signature-Timestamp');

	if (!signature || !timestamp) {
		return { valid: false, body: '' };
	}

	const body = await request.text();

	// verifyKey needs the raw body string (not parsed JSON) and the hex signature
	const valid = await verifyKey(body, signature, timestamp, publicKey);

	return { valid, body };
}
