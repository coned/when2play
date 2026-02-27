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

type ActionMode = null | 'call' | 'ping' | 'where' | 'judge_avail';

export function RallyPanel({ userId }: RallyPanelProps) {
	const [data, setData] = useState<RallyData | null>(null);
	const [users, setUsers] = useState<Array<{ id: string; discord_username: string; avatar_url: string | null }>>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState('');
	const [success, setSuccess] = useState('');
	const [actionMode, setActionMode] = useState<ActionMode>(null);
	const [callTiming, setCallTiming] = useState<'now' | 'later'>('now');
	const [optionalMessage, setOptionalMessage] = useState('');
	const [selectedUserId, setSelectedUserId] = useState('');

	const userMap = new Map(users.map((u) => [u.id, { discord_username: u.discord_username, avatar_url: u.avatar_url }]));

	const fetchData = useCallback(async () => {
		const [rallyResult, usersResult] = await Promise.all([api.getActiveRally(), api.getUsers()]);
		if (rallyResult.ok) setData(rallyResult.data);
		if (usersResult.ok) setUsers(usersResult.data);
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

	const handleCall = async () => {
		clearFeedback();
		setLoading(true);
		const result = await api.createRally({ timing: callTiming });
		if (result.ok) {
			setSuccess(`Rally started (${callTiming})!`);
			setActionMode(null);
			await fetchData();
		} else {
			setError(result.error.message);
		}
		setLoading(false);
	};

	const handleSimpleAction = async (actionType: 'in' | 'out' | 'brb') => {
		clearFeedback();
		setLoading(true);
		const result = await api.rallyAction({
			action_type: actionType,
			message: optionalMessage || undefined,
		});
		if (result.ok) {
			const labels = { in: "You're in!", out: "You're out.", brb: 'Marked as BRB.' };
			setSuccess(labels[actionType]);
			setOptionalMessage('');
			await fetchData();
		} else {
			setError(result.error.message);
		}
		setLoading(false);
	};

	const handleTargetedAction = async (actionType: 'ping' | 'where') => {
		if (!selectedUserId) {
			setError('Please select a user.');
			return;
		}
		clearFeedback();
		setLoading(true);
		const result = await api.rallyAction({
			action_type: actionType,
			target_user_ids: [selectedUserId],
			message: optionalMessage || undefined,
		});
		if (result.ok) {
			const target = userMap.get(selectedUserId)?.discord_username ?? 'user';
			setSuccess(actionType === 'ping' ? `Pinged ${target}!` : `Asked where ${target} is.`);
			setActionMode(null);
			setSelectedUserId('');
			setOptionalMessage('');
			await fetchData();
		} else {
			setError(result.error.message);
		}
		setLoading(false);
	};

	const handleJudgeTime = async () => {
		clearFeedback();
		setLoading(true);
		const result = await api.judgeTime();
		if (result.ok) {
			setSuccess('Judge computed time slots!');
			await fetchData();
		} else {
			setError(result.error.message);
		}
		setLoading(false);
	};

	const handleJudgeAvail = async () => {
		if (!selectedUserId) {
			setError('Please select a user to nudge.');
			return;
		}
		clearFeedback();
		setLoading(true);
		const result = await api.judgeAvail({ target_user_ids: [selectedUserId] });
		if (result.ok) {
			const target = userMap.get(selectedUserId)?.discord_username ?? 'user';
			setSuccess(`Nudged ${target} to set availability.`);
			setActionMode(null);
			setSelectedUserId('');
			await fetchData();
		} else {
			setError(result.error.message);
		}
		setLoading(false);
	};

	const otherUsers = users.filter((u) => u.id !== userId);

	const btnStyle = (active?: boolean): Record<string, string> => ({
		padding: '8px 14px',
		fontSize: '13px',
		minWidth: '80px',
		background: active ? 'var(--accent)' : 'var(--bg-tertiary)',
		color: active ? '#fff' : 'var(--text-primary)',
		border: '1px solid var(--border)',
		borderRadius: '6px',
		cursor: 'pointer',
	});

	return (
		<div>
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
				<div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
					<button style={btnStyle(actionMode === 'call')} onClick={() => { clearFeedback(); setActionMode(actionMode === 'call' ? null : 'call'); }}>
						{'\u{1F4E2}'} Call
					</button>
					<button style={btnStyle()} onClick={() => { clearFeedback(); handleSimpleAction('in'); }} disabled={loading}>
						{'\u2705'} In
					</button>
					<button style={btnStyle()} onClick={() => { clearFeedback(); handleSimpleAction('out'); }} disabled={loading}>
						{'\u274C'} Out
					</button>
					<button style={btnStyle()} onClick={() => { clearFeedback(); handleSimpleAction('brb'); }} disabled={loading}>
						{'\u23F3'} BRB
					</button>
					<button style={btnStyle(actionMode === 'ping')} onClick={() => { clearFeedback(); setActionMode(actionMode === 'ping' ? null : 'ping'); }}>
						{'\u{1F44B}'} Ping
					</button>
					<button style={btnStyle(actionMode === 'where')} onClick={() => { clearFeedback(); setActionMode(actionMode === 'where' ? null : 'where'); }}>
						{'\u2753'} Where
					</button>
					<button style={btnStyle()} onClick={() => { clearFeedback(); handleJudgeTime(); }} disabled={loading}>
						{'\u{1F916}'} Judge Time
					</button>
					<button style={btnStyle(actionMode === 'judge_avail')} onClick={() => { clearFeedback(); setActionMode(actionMode === 'judge_avail' ? null : 'judge_avail'); }}>
						{'\u{1F916}'} Judge Avail
					</button>
				</div>

				{/* Optional message input for simple actions */}
				<input
					type="text"
					placeholder="Optional message..."
					value={optionalMessage}
					onInput={(e) => setOptionalMessage((e.target as HTMLInputElement).value)}
					style={{ width: '100%', marginBottom: '8px' }}
					maxLength={500}
				/>

				{/* Call form */}
				{actionMode === 'call' && (
					<div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
						<button class={`btn ${callTiming === 'now' ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '4px 12px', fontSize: '12px' }} onClick={() => setCallTiming('now')}>
							Now
						</button>
						<button class={`btn ${callTiming === 'later' ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '4px 12px', fontSize: '12px' }} onClick={() => setCallTiming('later')}>
							Later
						</button>
						<button class="btn btn-primary" onClick={handleCall} disabled={loading} style={{ marginLeft: '8px' }}>
							{loading ? 'Starting...' : 'Start Rally'}
						</button>
					</div>
				)}

				{/* User selector for ping/where/judge_avail */}
				{(actionMode === 'ping' || actionMode === 'where' || actionMode === 'judge_avail') && (
					<div style={{ marginBottom: '8px' }}>
						<p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
							Select a user:
						</p>
						<div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
							{otherUsers.map((u) => (
								<button
									key={u.id}
									class={`btn ${selectedUserId === u.id ? 'btn-primary' : 'btn-secondary'}`}
									style={{ padding: '4px 10px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
									onClick={() => setSelectedUserId(u.id)}
								>
									{u.avatar_url && <img src={u.avatar_url} alt="" style={{ width: '18px', height: '18px', borderRadius: '50%' }} />}
									{u.discord_username}
								</button>
							))}
							{otherUsers.length === 0 && (
								<p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No other users yet.</p>
							)}
						</div>
						<button
							class="btn btn-primary"
							onClick={() => {
								if (actionMode === 'ping') handleTargetedAction('ping');
								else if (actionMode === 'where') handleTargetedAction('where');
								else if (actionMode === 'judge_avail') handleJudgeAvail();
							}}
							disabled={loading || !selectedUserId}
						>
							{loading ? 'Sending...' : actionMode === 'ping' ? 'Send Ping' : actionMode === 'where' ? 'Ask Where' : 'Nudge'}
						</button>
					</div>
				)}

				{error && <p style={{ color: 'var(--danger)', fontSize: '13px', marginTop: '4px' }}>{error}</p>}
				{success && <p style={{ color: 'var(--success)', fontSize: '13px', marginTop: '4px' }}>{success}</p>}
			</div>

			{/* Action feed */}
			<div class="card">
				<h3 style={{ marginBottom: '12px', fontSize: '15px' }}>Today's Actions</h3>
				<ActionFeed actions={data?.actions ?? []} users={userMap} />
			</div>
		</div>
	);
}
