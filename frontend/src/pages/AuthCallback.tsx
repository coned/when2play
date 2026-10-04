import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { api } from '../api/client';
import { takeReturnHash } from '../lib/routes';

interface AuthCallbackProps {
	token?: string;
}

type Phase =
	| { kind: 'working' }
	/** The link was expired, already used or never valid */
	| { kind: 'invalid' }
	/** The exchange request never got an answer; the token was not used */
	| { kind: 'network' }
	/** The server answered with something unexpected */
	| { kind: 'error'; message: string };

/** Open the app (on the tab remembered from before the login, if any) without keeping /auth/<token> in history. */
function enterApp() {
	window.location.replace('/' + takeReturnHash());
}

/**
 * Exchanges the one-time token from the bot's login link for a session.
 *
 * The page calls GET /api/auth/callback/<token> itself with fetch instead of
 * navigating there, so a failure shows a readable page instead of raw JSON. The
 * request is the same one the browser used to make (same URL, same-origin GET with
 * credentials), so the server answers the same way: on success a 302 to / whose
 * Set-Cookie headers set the session cookies. `redirect: 'manual'` makes fetch stop
 * at that 302 (it shows up as an opaque redirect); the browser stores the cookies of
 * a redirect response before it applies the redirect mode, exactly as it did for the
 * navigation. Then the page opens the app.
 */
export function AuthCallback({ token }: AuthCallbackProps) {
	const [phase, setPhase] = useState<Phase>({ kind: 'working' });
	const running = useRef(false);

	const exchange = useCallback(async () => {
		if (!token || running.current) return;
		running.current = true;
		setPhase({ kind: 'working' });
		try {
			const guild = new URLSearchParams(window.location.search).get('guild');
			const qs = guild ? `?guild=${encodeURIComponent(guild)}` : '';

			let res: Response;
			try {
				res = await fetch(`/api/auth/callback/${encodeURIComponent(token)}${qs}`, {
					method: 'GET',
					credentials: 'same-origin',
					redirect: 'manual',
					cache: 'no-store',
				});
			} catch {
				setPhase({ kind: 'network' });
				return;
			}

			if (res.type === 'opaqueredirect') {
				enterApp();
				return;
			}

			let body: { ok?: boolean; error?: { code?: string; message?: string } } | null = null;
			try {
				body = await res.json();
			} catch {
				body = null;
			}

			if (res.status === 401 || body?.error?.code === 'INVALID_TOKEN') {
				// Clicking an old link while already logged in to the same server is fine
				if (await hasSessionForGuild(guild)) {
					enterApp();
					return;
				}
				setPhase({ kind: 'invalid' });
				return;
			}

			setPhase({
				kind: 'error',
				message: body?.error?.message ?? `The server answered with HTTP ${res.status}.`,
			});
		} finally {
			running.current = false;
		}
	}, [token]);

	useEffect(() => {
		exchange();
	}, [exchange]);

	if (!token) {
		return <InvalidLink />;
	}

	if (phase.kind === 'invalid') {
		return <InvalidLink />;
	}

	if (phase.kind === 'network' || phase.kind === 'error') {
		return (
			<Screen>
				<div role="alert" class="card" style={{ padding: '20px 24px', maxWidth: '420px', textAlign: 'center' }}>
					<p style={{ color: 'var(--danger)', fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>
						{phase.kind === 'network' ? 'Cannot reach the server' : 'Login failed'}
					</p>
					<p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
						{phase.kind === 'network'
							? 'Your login link was not used yet. Check your connection and try again.'
							: phase.message}
					</p>
				</div>
				<button class="btn btn-primary" onClick={() => exchange()}>
					Retry
				</button>
			</Screen>
		);
	}

	return (
		<Screen>
			<div class="spinner" />
			<p style={{ color: 'var(--text-secondary)' }}>Logging in...</p>
		</Screen>
	);
}

/** True if this browser already has a valid session, for `guild` when one is given. */
async function hasSessionForGuild(guild: string | null): Promise<boolean> {
	const me = await api.getMe();
	if (!me.ok) return false;
	if (!guild) return true;
	const guilds = await api.getMyGuilds();
	return guilds.ok && guilds.data.current_guild_id === guild;
}

function InvalidLink() {
	return (
		<Screen>
			<div role="alert" class="card" style={{ padding: '20px 24px', maxWidth: '420px', textAlign: 'center' }}>
				<p style={{ color: 'var(--danger)', fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>
					This login link has expired or was already used
				</p>
				<p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '6px' }}>
					Run <code>/when2play</code> in your Discord server to get a new one.
				</p>
				<p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
					Each link is valid for 10 minutes and works once.
				</p>
			</div>
		</Screen>
	);
}

function Screen({ children }: { children: ComponentChildren }) {
	return (
		<div
			style={{
				height: '100%',
				display: 'flex',
				flexDirection: 'column',
				alignItems: 'center',
				justifyContent: 'center',
				gap: '16px',
				padding: '16px',
			}}
		>
			<h1 style={{ fontSize: '36px', fontWeight: 700, color: 'var(--accent-text)' }}>when2play</h1>
			{children}
		</div>
	);
}
