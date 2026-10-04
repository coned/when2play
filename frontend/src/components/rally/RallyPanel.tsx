import { useState, useEffect, useCallback, useMemo } from 'preact/hooks';
import { api } from '../../api/client';
import { ActionFeed } from './ActionFeed';
import { useVisiblePolling } from '../../hooks/useVisiblePolling';
import { avatarInitial } from '../../lib/initials';
import { buildRoster, ROSTER_STATUSES, type RosterEntry, type RosterStatus } from '../../lib/rallyRoster';

interface RallyPanelProps {
	userId: string;
}

interface RallyData {
	rally: { id: string; timing: string; day_key: string; status: string; created_at: string } | null;
	actions: Array<{
		id: string;
		rally_id: string | null;
		actor_id: string;
		action_type: string;
		actor_username: string;
		actor_avatar: string | null;
		target_user_ids: string[] | null;
		message: string | null;
		metadata: Record<string, unknown> | null;
		created_at: string;
		delivery_status?: 'pending' | 'delivered' | 'expired';
	}>;
	/** Discord bot liveness for this server, from its last poll. */
	bot?: { online: boolean; last_seen_at: string | null };
}

interface RallySettings {
	rally_button_labels: Record<string, string>;
	rally_suggested_phrases: Record<string, string[]>;
	rally_show_discord_command: boolean;
	rally_anonymous_enabled: Record<string, boolean>;
}

type ExpandedButton = null | 'call' | 'in' | 'out' | 'brb' | 'ping' | 'where' | 'judge_time' | 'judge_avail' | 'share_ranking';

const DEFAULT_LABELS: Record<string, string> = {
	call: 'Call', in: 'In', out: 'Out', brb: 'BRB',
	ping: 'Ping', where: 'Where', judge_time: 'Post schedule', judge_avail: 'Nudge availability',
	share_ranking: 'Share ranking',
};

/** Answers sent with one tap (no message); each keeps a secondary control to add one. */
const QUICK_ACTIONS = ['in', 'out', 'brb'] as const;
type QuickAction = (typeof QUICK_ACTIONS)[number];

/** The channel-wide posts, grouped under "More". */
const MORE_ACTIONS: ExpandedButton[] = ['judge_avail', 'judge_time', 'share_ranking'];

const QUICK_SUCCESS: Record<QuickAction, string> = { in: "You're in!", out: "You're out.", brb: 'Marked as BRB.' };

const ROSTER_GROUPS: Record<RosterStatus, { title: string; color: string }> = {
	in: { title: 'In', color: 'var(--success)' },
	brb: { title: 'BRB', color: 'var(--warning)' },
	out: { title: 'Out', color: 'var(--danger)' },
};

/** How long a success message stays (errors stay until the next action) */
const SUCCESS_MS = 4000;

function RosterChip({ entry, isMe }: { entry: RosterEntry; isMe: boolean }) {
	return (
		<li
			style={{
				display: 'flex',
				alignItems: 'center',
				gap: '6px',
				padding: '3px 10px 3px 3px',
				borderRadius: '9999px',
				background: 'var(--bg-tertiary)',
				border: isMe ? '1px solid var(--accent)' : '1px solid var(--border)',
				fontSize: '13px',
				color: 'var(--text-primary)',
			}}
		>
			{entry.avatarUrl ? (
				<img src={entry.avatarUrl} alt="" style={{ width: '22px', height: '22px', borderRadius: '50%', flexShrink: 0 }} />
			) : (
				<span
					aria-hidden="true"
					style={{
						width: '22px',
						height: '22px',
						borderRadius: '50%',
						background: 'var(--accent)',
						color: 'var(--on-accent)',
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						fontSize: '11px',
						fontWeight: 700,
						flexShrink: 0,
					}}
				>
					{avatarInitial(entry.name)}
				</span>
			)}
			<span style={{ fontWeight: isMe ? 600 : 400 }}>{entry.name}</span>
			{isMe && <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>(you)</span>}
		</li>
	);
}

const BUTTON_EMOJIS: Record<string, string> = {
	call: '\u{1F4E2}', in: '\u2705', out: '\u274C', brb: '\u23F3',
	ping: '\u{1F44B}', where: '\u2753', judge_time: '\u{1F916}', judge_avail: '\u{1F916}',
	share_ranking: '\u{1F3C6}',
};

const DISCORD_COMMANDS: Record<string, string> = {
	call: '/call', in: '/in', out: '/out', brb: '/brb',
	ping: '/ping', where: '/where', judge_avail: '/call2select', judge_time: '/post schedule',
	share_ranking: '/post gamerank',
};

export function RallyPanel({ userId }: RallyPanelProps) {
	const [data, setData] = useState<RallyData | null>(null);
	const [users, setUsers] = useState<Array<{ id: string; discord_username: string; display_name: string | null; avatar_url: string | null }>>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState('');
	const [success, setSuccess] = useState('');
	const [expandedButton, setExpandedButton] = useState<ExpandedButton>(null);
	const [actionAnonymous, setActionAnonymous] = useState(false);
	const [composeMessage, setComposeMessage] = useState('');
	const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
	const [rallySettings, setRallySettings] = useState<RallySettings>({
		rally_button_labels: {},
		rally_suggested_phrases: {},
		rally_show_discord_command: true,
		rally_anonymous_enabled: { call: true, ping: true },
	});

	const userMap = useMemo(
		() => new Map(users.map((u) => [u.id, { discord_username: u.discord_username, display_name: u.display_name, avatar_url: u.avatar_url }])),
		[users],
	);
	const roster = useMemo(() => buildRoster(data?.actions ?? [], userMap), [data, userMap]);
	const rosterCount = ROSTER_STATUSES.reduce((n, s) => n + roster[s].length, 0);

	const fetchRally = useCallback(async () => {
		const rallyResult = await api.getActiveRally();
		if (rallyResult.ok) setData(rallyResult.data);
	}, []);

	const fetchUsersAndSettings = useCallback(async () => {
		const [usersResult, settingsResult] = await Promise.all([
			api.getUsers(),
			api.getSettings(),
		]);
		if (usersResult.ok) setUsers(usersResult.data);
		if (settingsResult.ok) {
			const s = settingsResult.data as Record<string, unknown>;
			setRallySettings({
				rally_button_labels: (s.rally_button_labels as Record<string, string>) ?? {},
				rally_suggested_phrases: (s.rally_suggested_phrases as Record<string, string[]>) ?? {},
				rally_show_discord_command: s.rally_show_discord_command !== false,
				rally_anonymous_enabled: (s.rally_anonymous_enabled as Record<string, boolean>) ?? { call: true, ping: true },
			});
		}
	}, []);

	// Users and settings rarely change: load once. Only the rally is polled.
	useEffect(() => {
		fetchUsersAndSettings();
	}, [fetchUsersAndSettings]);

	useVisiblePolling(fetchRally, 20_000);

	// A success message goes away by itself; an error stays until the next action
	useEffect(() => {
		if (!success) return;
		const t = setTimeout(() => setSuccess(''), SUCCESS_MS);
		return () => clearTimeout(t);
	}, [success]);

	const clearFeedback = () => {
		setError('');
		setSuccess('');
	};

	const closeCompose = () => {
		setExpandedButton(null);
		setComposeMessage('');
		setSelectedUserIds(new Set());
		setActionAnonymous(false);
	};

	const toggleButton = (btn: ExpandedButton) => {
		clearFeedback();
		// The anonymous choice belongs to one action: never carry it to another
		setActionAnonymous(false);
		if (expandedButton === btn) {
			closeCompose();
		} else {
			setExpandedButton(btn);
			// Auto-select first phrase if available
			const btnPhrases = btn ? getSuggestedPhrases(btn) : [];
			setComposeMessage(btnPhrases.length > 0 ? btnPhrases[0] : '');
			setSelectedUserIds(new Set());
		}
	};

	const getLabel = (actionType: string) =>
		rallySettings.rally_button_labels[actionType] || DEFAULT_LABELS[actionType] || actionType;

	const getSuggestedPhrases = (actionType: string) =>
		rallySettings.rally_suggested_phrases[actionType] ?? [];

	const shouldShowAnonymous = (actionType: string | null) =>
		actionType ? (rallySettings.rally_anonymous_enabled[actionType] ?? false) : false;

	const userNames = (ids: Set<string>) =>
		[...ids].map((id) => { const u = userMap.get(id); return u?.display_name ?? u?.discord_username ?? 'user'; }).join(', ');

	/** In / Out / BRB with one tap: sent at once, without a message. */
	const sendQuick = async (type: QuickAction) => {
		if (loading) return;
		clearFeedback();
		closeCompose();
		setLoading(true);
		const result = await api.rallyAction({ action_type: type });
		setLoading(false);
		if (!result.ok) {
			setError(result.error.message);
			return;
		}
		setSuccess(QUICK_SUCCESS[type]);
		await fetchRally();
	};

	const handleSend = async () => {
		if (!expandedButton) return;
		clearFeedback();

		const needsTargets = expandedButton === 'ping' || expandedButton === 'where' || expandedButton === 'judge_avail';
		if (needsTargets && selectedUserIds.size === 0) {
			setError(expandedButton === 'judge_avail' ? 'Please select at least one user to nudge.' : 'Please select at least one user.');
			return;
		}

		setLoading(true);
		const message = composeMessage.trim() || undefined;
		const anonymous = (shouldShowAnonymous(expandedButton) && actionAnonymous) || undefined;
		let result: { ok: true } | { ok: false; error: { message: string } };
		let done = 'Done!';

		if (expandedButton === 'call') {
			result = await api.createRally({ message, is_anonymous: anonymous });
			done = 'Rally started!';
		} else if (expandedButton === 'share_ranking') {
			result = await api.shareRanking();
			done = 'Game ranking shared to Discord!';
		} else if (expandedButton === 'in' || expandedButton === 'out' || expandedButton === 'brb') {
			result = await api.rallyAction({ action_type: expandedButton, message, is_anonymous: anonymous });
			done = QUICK_SUCCESS[expandedButton];
		} else if (expandedButton === 'ping' || expandedButton === 'where') {
			result = await api.rallyAction({ action_type: expandedButton, target_user_ids: [...selectedUserIds], message, is_anonymous: anonymous });
			done = expandedButton === 'ping' ? `Pinged ${userNames(selectedUserIds)}!` : `Asked where ${userNames(selectedUserIds)} is.`;
		} else if (expandedButton === 'judge_time') {
			result = await api.judgeTime();
			done = 'Schedule posted to Discord!';
		} else {
			result = await api.judgeAvail({ target_user_ids: [...selectedUserIds], message });
			done = `Nudged ${userNames(selectedUserIds)} to set availability.`;
		}

		setLoading(false);
		if (!result.ok) {
			setError(result.error.message);
			return;
		}
		setSuccess(done);
		closeCompose();
		await fetchRally();
	};

	const toggleUser = (uid: string) => {
		setSelectedUserIds((prev) => {
			const next = new Set(prev);
			if (next.has(uid)) next.delete(uid);
			else next.add(uid);
			return next;
		});
	};

	const needsUserSelect = expandedButton === 'ping' || expandedButton === 'where' || expandedButton === 'judge_avail';
	const phrases = expandedButton ? getSuggestedPhrases(expandedButton) : [];
	const showHints = rallySettings.rally_show_discord_command;

	const actionButtonStyle = (active: boolean, size: 'primary' | 'secondary' | 'more'): Record<string, string> => ({
		padding: size === 'primary' ? '10px 16px' : size === 'secondary' ? '8px 14px' : '6px 12px',
		fontSize: size === 'primary' ? '15px' : size === 'secondary' ? '13px' : '12px',
		fontWeight: size === 'primary' ? '600' : '500',
		minWidth: size === 'more' ? '0' : '80px',
		background: active ? 'var(--accent)' : size === 'more' ? 'transparent' : 'var(--bg-tertiary)',
		color: active ? 'var(--on-accent)' : size === 'more' ? 'var(--text-secondary)' : 'var(--text-primary)',
		border: '1px solid var(--border)',
		borderRadius: '6px',
		cursor: 'pointer',
		textAlign: 'center',
	});

	const hint = (at: string, active: boolean) =>
		showHints && DISCORD_COMMANDS[at] ? (
			<div aria-hidden="true" style={{ fontSize: '10px', color: active ? 'var(--on-accent)' : 'var(--text-muted)', marginTop: '2px', fontWeight: 400 }}>
				{DISCORD_COMMANDS[at]}
			</div>
		) : null;

	/** A button that opens the compose area (Call, Ping, Where and the More posts) */
	const expandButton = (at: Exclude<ExpandedButton, null>, size: 'primary' | 'secondary' | 'more') => (
		<button
			key={at}
			type="button"
			class="touch-target"
			style={actionButtonStyle(expandedButton === at, size)}
			aria-pressed={expandedButton === at}
			onClick={() => toggleButton(at)}
			disabled={loading}
		>
			<div>
				<span aria-hidden="true">{BUTTON_EMOJIS[at]} </span>
				{getLabel(at)}
			</div>
			{hint(at, expandedButton === at)}
		</button>
	);

	/** In / Out / BRB: the main part sends at once, the small part opens the compose area first */
	const quickButton = (at: QuickAction) => {
		const composing = expandedButton === at;
		return (
			<div key={at} style={{ display: 'inline-flex', alignItems: 'stretch' }}>
				<button
					type="button"
					class="touch-target"
					style={{ ...actionButtonStyle(false, 'primary'), borderRadius: '6px 0 0 6px' }}
					onClick={() => sendQuick(at)}
					disabled={loading}
					title={`Send "${getLabel(at)}" now`}
				>
					<div>
						<span aria-hidden="true">{BUTTON_EMOJIS[at]} </span>
						{getLabel(at)}
					</div>
					{hint(at, false)}
				</button>
				<button
					type="button"
					class="touch-target"
					style={{
						...actionButtonStyle(composing, 'secondary'),
						minWidth: '32px',
						padding: '4px 8px',
						borderLeft: 'none',
						borderRadius: '0 6px 6px 0',
					}}
					aria-label={`${getLabel(at)} with a message`}
					title="Add a message first"
					aria-pressed={composing}
					onClick={() => toggleButton(at)}
					disabled={loading}
				>
					<span aria-hidden="true">{'\u270E'}</span>
				</button>
			</div>
		);
	};

	return (
		<div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
			<h2 style={{ marginBottom: '12px' }}>Rally</h2>

			{/* Today's roster: each person's latest answer */}
			<section aria-labelledby="rally-roster-heading" class="card" style={{ marginBottom: '16px' }}>
				<div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' }}>
					<h3 id="rally-roster-heading" style={{ fontSize: '15px' }}>Today's roster</h3>
					{data?.rally && (
						<span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
							{data.rally.status === 'open' ? 'Rally open' : `Rally ${data.rally.status}`}
						</span>
					)}
				</div>
				{rosterCount === 0 ? (
					<p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
						{data?.rally ? 'Nobody has answered yet. Tap In, Out or BRB below.' : 'No rally yet today. Hit Call to start one, or tap In, Out or BRB.'}
					</p>
				) : (
					<div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
						{ROSTER_STATUSES.map((status) => {
							const group = ROSTER_GROUPS[status];
							const entries = roster[status];
							const headingId = `rally-roster-${status}`;
							return (
								<div key={status} role="group" aria-labelledby={headingId} data-roster-group={status}>
									<h4 id={headingId} style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
										<span aria-hidden="true" style={{ width: '8px', height: '8px', borderRadius: '50%', background: group.color, display: 'inline-block' }} />
										{group.title} ({entries.length})
									</h4>
									{entries.length === 0 ? (
										<p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Nobody</p>
									) : (
										<ul style={{ listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
											{entries.map((e) => (
												<RosterChip key={e.userId} entry={e} isMe={e.userId === userId} />
											))}
										</ul>
									)}
								</div>
							);
						})}
					</div>
				)}
			</section>

			{data?.bot && !data.bot.online && (
				<div
					role="alert"
					style={{
						marginBottom: '16px',
						padding: '10px 14px',
						border: '1px solid var(--warning)',
						borderLeft: '4px solid var(--warning)',
						borderRadius: '6px',
						background: 'var(--bg-tertiary)',
						fontSize: '13px',
						color: 'var(--text-primary)',
					}}
				>
					<strong style={{ color: 'var(--warning)' }}>Discord bot is not picking up messages for this server.</strong>{' '}
					Either the bot is offline or no output channel is set (an admin can run <code>/setchannel</code> in Discord).
					Actions are queued, but anything not delivered within 30 minutes is dropped.
					{data.bot.last_seen_at && (
						<span style={{ color: 'var(--text-muted)' }}>
							{' '}Last seen {new Date(data.bot.last_seen_at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}.
						</span>
					)}
				</div>
			)}

			{/* Action buttons */}
			<div class="card" style={{ marginBottom: '16px' }}>
				<div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
					{expandButton('call', 'primary')}
					{QUICK_ACTIONS.map((at) => quickButton(at))}
				</div>
				<div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
					{expandButton('ping', 'secondary')}
					{expandButton('where', 'secondary')}
				</div>

				<div style={{ marginTop: '14px' }}>
					<h4 style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: '6px' }}>
						More
					</h4>
					<div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
						{MORE_ACTIONS.map((at) => expandButton(at!, 'more'))}
					</div>
				</div>

				{/* Compose area */}
				{expandedButton && (
					<div style={{ borderTop: '1px solid var(--border)', paddingTop: '12px', marginTop: '12px' }}>
						<p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
							<span aria-hidden="true">{BUTTON_EMOJIS[expandedButton]} </span>
							{getLabel(expandedButton)}
						</p>

						{/* Anonymous option */}
						{shouldShowAnonymous(expandedButton) && (
							<div style={{ marginBottom: '8px' }}>
								<label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
									<input
										type="checkbox"
										checked={actionAnonymous}
										onChange={(e) => setActionAnonymous((e.target as HTMLInputElement).checked)}
										style={{ width: 'auto' }}
									/>
									Anonymous (hide my name)
								</label>
							</div>
						)}

						{/* User selector for ping/where/judge_avail */}
						{needsUserSelect && (
							<div style={{ marginBottom: '8px' }}>
								<p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
									Select user(s):
								</p>
								<div role="group" aria-label="Select users" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
									{users.map((u) => (
										<button
											key={u.id}
											type="button"
											class={`btn ${selectedUserIds.has(u.id) ? 'btn-primary' : 'btn-secondary'}`}
											style={{ padding: '4px 10px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
											aria-pressed={selectedUserIds.has(u.id)}
											onClick={() => toggleUser(u.id)}
										>
											{u.avatar_url && <img src={u.avatar_url} alt="" style={{ width: '18px', height: '18px', borderRadius: '50%' }} />}
											{u.display_name ?? u.discord_username}
											{u.id === userId && <span style={{ fontSize: '10px' }}>(you)</span>}
										</button>
									))}
									{users.length === 0 && (
										<p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No users yet.</p>
									)}
								</div>
							</div>
						)}

						{/* Suggested phrases */}
						{phrases.length > 0 && (
							<div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }}>
								{phrases.map((phrase) => (
									<button
										key={phrase}
										type="button"
										class={`btn ${composeMessage === phrase ? 'btn-primary' : 'btn-secondary'}`}
										style={{ padding: '2px 8px', fontSize: '11px' }}
										onClick={() => setComposeMessage(composeMessage === phrase ? '' : phrase)}
									>
										{phrase}
									</button>
								))}
							</div>
						)}

						{/* Message input (the schedule post takes none) */}
						{expandedButton !== 'judge_time' && expandedButton !== 'share_ranking' && (
							<input
								type="text"
								placeholder="Optional message..."
								aria-label="Message"
								value={composeMessage}
								onInput={(e) => setComposeMessage((e.target as HTMLInputElement).value)}
								style={{ width: '100%', marginBottom: '8px' }}
								maxLength={500}
							/>
						)}

						<div style={{ display: 'flex', gap: '8px' }}>
							<button
								type="button"
								class="btn btn-primary"
								onClick={handleSend}
								disabled={loading || (needsUserSelect && selectedUserIds.size === 0)}
							>
								{loading ? 'Sending...' : 'Send'}
							</button>
							<button type="button" class="btn btn-secondary" onClick={() => { clearFeedback(); closeCompose(); }} disabled={loading}>
								Cancel
							</button>
						</div>
					</div>
				)}

				{/* Feedback: the status region stays in the page so screen readers announce what appears in it */}
				<div role="status" style={{ minHeight: success ? undefined : 0 }}>
					{success && <p style={{ color: 'var(--success)', fontSize: '13px', marginTop: '8px' }}>{success}</p>}
				</div>
				{error && (
					<p role="alert" style={{ color: 'var(--danger)', fontSize: '13px', marginTop: '8px' }}>
						{error}
					</p>
				)}
			</div>

			{/* Action feed */}
			<div class="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
				<h3 style={{ marginBottom: '12px', fontSize: '15px', flexShrink: 0 }}>Today's actions</h3>
				<ActionFeed actions={data?.actions ?? []} users={userMap} />
			</div>
		</div>
	);
}
