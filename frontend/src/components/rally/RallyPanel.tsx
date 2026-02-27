import { useState, useEffect, useCallback } from 'preact/hooks';
import { api } from '../../api/client';
import { ActionFeed } from './ActionFeed';

interface RallyPanelProps {
	userId: string;
}

interface RallyData {
	rally: { id: string; creator_id: string; timing: string; day_key: string; status: string; created_at: string } | null;
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
	}>;
}

interface RallySettings {
	rally_button_labels: Record<string, string>;
	rally_suggested_phrases: Record<string, string[]>;
	rally_show_discord_command: boolean;
}

type ExpandedButton = null | 'call' | 'in' | 'out' | 'brb' | 'ping' | 'where' | 'judge_time' | 'judge_avail' | 'share_ranking';

const DEFAULT_LABELS: Record<string, string> = {
	call: 'Call', in: 'In', out: 'Out', brb: 'BRB',
	ping: 'Ping', where: 'Where', judge_time: 'Judge Time', judge_avail: 'Judge Avail',
	share_ranking: 'Share Ranking',
};

const BUTTON_EMOJIS: Record<string, string> = {
	call: '\u{1F4E2}', in: '\u2705', out: '\u274C', brb: '\u23F3',
	ping: '\u{1F44B}', where: '\u2753', judge_time: '\u{1F916}', judge_avail: '\u{1F916}',
	share_ranking: '\u{1F3C6}',
};

const DISCORD_COMMANDS: Record<string, string> = {
	call: '/call', in: '/in', out: '/out', brb: '/brb',
	ping: '/ping', where: '/where', judge_time: '/judge time', judge_avail: '/judge avail',
	share_ranking: '',
};

export function RallyPanel({ userId }: RallyPanelProps) {
	const [data, setData] = useState<RallyData | null>(null);
	const [users, setUsers] = useState<Array<{ id: string; discord_username: string; display_name: string | null; avatar_url: string | null }>>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState('');
	const [success, setSuccess] = useState('');
	const [expandedButton, setExpandedButton] = useState<ExpandedButton>(null);
	const [callTiming, setCallTiming] = useState<'now' | 'later'>('now');
	const [callAnonymous, setCallAnonymous] = useState(false);
	const [composeMessage, setComposeMessage] = useState('');
	const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
	const [rallySettings, setRallySettings] = useState<RallySettings>({
		rally_button_labels: {},
		rally_suggested_phrases: {},
		rally_show_discord_command: true,
	});

	const userMap = new Map(users.map((u) => [u.id, { discord_username: u.discord_username, display_name: u.display_name, avatar_url: u.avatar_url }]));

	const fetchData = useCallback(async () => {
		const [rallyResult, usersResult, settingsResult] = await Promise.all([
			api.getActiveRally(),
			api.getUsers(),
			api.getSettings(),
		]);
		if (rallyResult.ok) setData(rallyResult.data);
		if (usersResult.ok) setUsers(usersResult.data);
		if (settingsResult.ok) {
			const s = settingsResult.data as Record<string, unknown>;
			setRallySettings({
				rally_button_labels: (s.rally_button_labels as Record<string, string>) ?? {},
				rally_suggested_phrases: (s.rally_suggested_phrases as Record<string, string[]>) ?? {},
				rally_show_discord_command: s.rally_show_discord_command !== false,
			});
		}
	}, []);

	useEffect(() => {
		fetchData();
		const interval = setInterval(fetchData, 20_000);
		return () => clearInterval(interval);
	}, [fetchData]);

	const clearFeedback = () => {
		setError('');
		setSuccess('');
	};

	const toggleButton = (btn: ExpandedButton) => {
		clearFeedback();
		if (expandedButton === btn) {
			setExpandedButton(null);
			setComposeMessage('');
			setSelectedUserIds(new Set());
		} else {
			setExpandedButton(btn);
			setComposeMessage('');
			setSelectedUserIds(new Set());
		}
	};

	const getLabel = (actionType: string) =>
		rallySettings.rally_button_labels[actionType] || DEFAULT_LABELS[actionType] || actionType;

	const getSuggestedPhrases = (actionType: string) =>
		rallySettings.rally_suggested_phrases[actionType] ?? [];

	const handleSend = async () => {
		if (!expandedButton) return;
		clearFeedback();
		setLoading(true);

		try {
			if (expandedButton === 'call') {
				const result = await api.createRally({ timing: callTiming, is_anonymous: callAnonymous || undefined });
				if (result.ok) {
					setSuccess(`Rally started (${callTiming})!`);
					setExpandedButton(null);
					setComposeMessage('');
					setCallAnonymous(false);
					await fetchData();
				} else {
					setError(result.error.message);
				}
			} else if (expandedButton === 'share_ranking') {
				const result = await api.shareRanking();
				if (result.ok) {
					setSuccess('Game ranking shared to Discord!');
					setExpandedButton(null);
					await fetchData();
				} else {
					setError(result.error.message);
				}
			} else if (['in', 'out', 'brb'].includes(expandedButton)) {
				const result = await api.rallyAction({
					action_type: expandedButton,
					message: composeMessage || undefined,
				});
				if (result.ok) {
					const labels = { in: "You're in!", out: "You're out.", brb: 'Marked as BRB.' };
					setSuccess(labels[expandedButton as keyof typeof labels] ?? 'Done!');
					setExpandedButton(null);
					setComposeMessage('');
					await fetchData();
				} else {
					setError(result.error.message);
				}
			} else if (expandedButton === 'ping' || expandedButton === 'where') {
				if (selectedUserIds.size === 0) {
					setError('Please select at least one user.');
					setLoading(false);
					return;
				}
				const result = await api.rallyAction({
					action_type: expandedButton,
					target_user_ids: [...selectedUserIds],
					message: composeMessage || undefined,
				});
				if (result.ok) {
					const names = [...selectedUserIds]
						.map((id) => { const u = userMap.get(id); return u?.display_name ?? u?.discord_username ?? 'user'; })
						.join(', ');
					setSuccess(expandedButton === 'ping' ? `Pinged ${names}!` : `Asked where ${names} is.`);
					setExpandedButton(null);
					setComposeMessage('');
					setSelectedUserIds(new Set());
					await fetchData();
				} else {
					setError(result.error.message);
				}
			} else if (expandedButton === 'judge_time') {
				const result = await api.judgeTime();
				if (result.ok) {
					setSuccess('Judge computed time slots!');
					setExpandedButton(null);
					setComposeMessage('');
					await fetchData();
				} else {
					setError(result.error.message);
				}
			} else if (expandedButton === 'judge_avail') {
				if (selectedUserIds.size === 0) {
					setError('Please select at least one user to nudge.');
					setLoading(false);
					return;
				}
				const result = await api.judgeAvail({ target_user_ids: [...selectedUserIds] });
				if (result.ok) {
					const names = [...selectedUserIds]
						.map((id) => { const u = userMap.get(id); return u?.display_name ?? u?.discord_username ?? 'user'; })
						.join(', ');
					setSuccess(`Nudged ${names} to set availability.`);
					setExpandedButton(null);
					setComposeMessage('');
					setSelectedUserIds(new Set());
					await fetchData();
				} else {
					setError(result.error.message);
				}
			}
		} catch {
			setError('Something went wrong.');
		}

		setLoading(false);
	};

	const toggleUser = (uid: string) => {
		setSelectedUserIds((prev) => {
			const next = new Set(prev);
			if (next.has(uid)) next.delete(uid);
			else next.add(uid);
			return next;
		});
	};

	const otherUsers = users.filter((u) => u.id !== userId);
	const needsUserSelect = expandedButton === 'ping' || expandedButton === 'where' || expandedButton === 'judge_avail';
	const needsTimingSelect = expandedButton === 'call';
	const phrases = expandedButton ? getSuggestedPhrases(expandedButton) : [];

	const btnStyle = (actionType: string): Record<string, string> => ({
		padding: '8px 14px',
		fontSize: '13px',
		minWidth: '80px',
		background: expandedButton === actionType ? 'var(--accent)' : 'var(--bg-tertiary)',
		color: expandedButton === actionType ? '#fff' : 'var(--text-primary)',
		border: '1px solid var(--border)',
		borderRadius: '6px',
		cursor: 'pointer',
		textAlign: 'center',
	});

	const actionTypes: ExpandedButton[] = ['call', 'in', 'out', 'brb', 'ping', 'where', 'judge_time', 'judge_avail', 'share_ranking'];

	return (
		<div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
			<h2 style={{ marginBottom: '8px' }}>Rally</h2>

			{data?.rally && (
				<p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
					Active rally for {data.rally.day_key} &mdash; {data.rally.status} &mdash; {data.actions.length} action{data.actions.length !== 1 ? 's' : ''}
				</p>
			)}
			{!data?.rally && (
				<p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '16px' }}>
					No active rally today. Hit Call to start one!
				</p>
			)}

			{/* Action buttons */}
			<div class="card" style={{ marginBottom: '16px' }}>
				<div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: expandedButton ? '12px' : '0' }}>
					{actionTypes.map((at) => (
						<button
							key={at}
							style={btnStyle(at!)}
							onClick={() => toggleButton(at)}
							disabled={loading}
						>
							<div>{BUTTON_EMOJIS[at!]} {getLabel(at!)}</div>
							{rallySettings.rally_show_discord_command && (
								<div style={{ fontSize: '10px', color: expandedButton === at ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)', marginTop: '2px' }}>
									{DISCORD_COMMANDS[at!]}
								</div>
							)}
						</button>
					))}
				</div>

				{/* Compose area */}
				{expandedButton && (
					<div style={{ borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
						{/* Timing selector for Call */}
						{needsTimingSelect && (
							<div style={{ marginBottom: '8px' }}>
								<div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px' }}>
									<button class={`btn ${callTiming === 'now' ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '4px 12px', fontSize: '12px' }} onClick={() => setCallTiming('now')}>
										Now
									</button>
									<button class={`btn ${callTiming === 'later' ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '4px 12px', fontSize: '12px' }} onClick={() => setCallTiming('later')}>
										Later
									</button>
								</div>
								<label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
									<input
										type="checkbox"
										checked={callAnonymous}
										onChange={(e) => setCallAnonymous((e.target as HTMLInputElement).checked)}
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
								<div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
									{otherUsers.map((u) => (
										<button
											key={u.id}
											class={`btn ${selectedUserIds.has(u.id) ? 'btn-primary' : 'btn-secondary'}`}
											style={{ padding: '4px 10px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
											onClick={() => toggleUser(u.id)}
										>
											{u.avatar_url && <img src={u.avatar_url} alt="" style={{ width: '18px', height: '18px', borderRadius: '50%' }} />}
											{u.display_name ?? u.discord_username}
										</button>
									))}
									{otherUsers.length === 0 && (
										<p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No other users yet.</p>
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
										class="btn btn-secondary"
										style={{ padding: '2px 8px', fontSize: '11px' }}
										onClick={() => setComposeMessage(phrase)}
									>
										{phrase}
									</button>
								))}
							</div>
						)}

						{/* Message input */}
						<input
							type="text"
							placeholder="Optional message..."
							value={composeMessage}
							onInput={(e) => setComposeMessage((e.target as HTMLInputElement).value)}
							style={{ width: '100%', marginBottom: '8px' }}
							maxLength={500}
						/>

						{/* Send button */}
						<button
							class="btn btn-primary"
							onClick={handleSend}
							disabled={loading || (needsUserSelect && selectedUserIds.size === 0)}
						>
							{loading ? 'Sending...' : 'Send'}
						</button>
					</div>
				)}

				{error && <p style={{ color: 'var(--danger)', fontSize: '13px', marginTop: '4px' }}>{error}</p>}
				{success && <p style={{ color: 'var(--success)', fontSize: '13px', marginTop: '4px' }}>{success}</p>}
			</div>

			{/* Action feed */}
			<div class="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
				<h3 style={{ marginBottom: '12px', fontSize: '15px', flexShrink: 0 }}>Today's Actions</h3>
				<ActionFeed actions={data?.actions ?? []} users={userMap} />
			</div>
		</div>
	);
}
