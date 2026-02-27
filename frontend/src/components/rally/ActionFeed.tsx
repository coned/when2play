import { useRef, useEffect } from 'preact/hooks';

interface ActionItem {
	id: string;
	action_type: string;
	actor_username: string;
	actor_avatar: string | null;
	target_user_ids: string[] | null;
	message: string | null;
	metadata: Record<string, unknown> | null;
	created_at: string;
}

interface ActionFeedProps {
	actions: ActionItem[];
	users: Map<string, { discord_username: string; display_name: string | null; avatar_url: string | null }>;
}

const ACTION_CONFIG: Record<string, { icon: string; color: string; label: string }> = {
	call: { icon: '\u{1F4E2}', color: '#4a9eff', label: 'called' },
	in: { icon: '\u2705', color: '#4caf50', label: 'is in' },
	out: { icon: '\u274C', color: '#f44336', label: 'is out' },
	ping: { icon: '\u{1F44B}', color: '#ff9800', label: 'pinged' },
	judge_time: { icon: '\u{1F916}', color: '#26a69a', label: 'judge: time' },
	judge_avail: { icon: '\u{1F916}', color: '#26a69a', label: 'judge: avail' },
	brb: { icon: '\u23F3', color: '#ffc107', label: 'brb' },
	where: { icon: '\u2753', color: '#9c27b0', label: 'asked where' },
	share_ranking: { icon: '\u{1F3C6}', color: '#f59e0b', label: 'shared ranking' },
};

function formatTime(iso: string): string {
	const d = new Date(iso);
	return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function formatAction(action: ActionItem, users: Map<string, { discord_username: string; display_name: string | null; avatar_url: string | null }>): string {
	const config = ACTION_CONFIG[action.action_type];
	if (!config) return action.action_type;

	let text = `${config.label}`;

	if (['ping', 'where'].includes(action.action_type) && action.target_user_ids) {
		const targets = action.target_user_ids
			.map((id) => { const u = users.get(id); return u?.display_name ?? u?.discord_username ?? 'someone'; })
			.join(', ');
		text += ` ${targets}`;
	}

	if (action.message) {
		text += ` — "${action.message}"`;
	}

	if (action.action_type === 'judge_time' && action.metadata) {
		const meta = action.metadata as { windows?: Array<{ start: string; end: string; user_count: number }>; day_key?: string };
		if (meta.windows && meta.windows.length > 0) {
			const toLocal = (t: string) => {
				if (!meta.day_key) return t;
				return new Date(`${meta.day_key}T${t}:00Z`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
			};
			const windowStrs = meta.windows.slice(0, 3).map((w) => `${toLocal(w.start)}–${toLocal(w.end)} (${w.user_count})`);
			text = `Best windows: ${windowStrs.join(', ')}`;
		} else {
			text = 'No overlapping availability found';
		}
	}

	if (action.action_type === 'share_ranking' && action.metadata) {
		const meta = action.metadata as { ranking?: Array<{ name: string; total_score: number; vote_count: number }> };
		if (meta.ranking && meta.ranking.length > 0) {
			const lines = meta.ranking.slice(0, 5).map((r, i) => `#${i + 1} ${r.name} (${r.total_score} pts)`);
			text = `— ${lines.join(', ')}`;
		}
	}

	return text;
}

export function ActionFeed({ actions, users }: ActionFeedProps) {
	const bottomRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
	}, [actions.length]);

	if (actions.length === 0) {
		return (
			<div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>
				No actions yet today. Start a rally with the Call button!
			</div>
		);
	}

	return (
		<div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
			{actions.map((action) => {
				const config = ACTION_CONFIG[action.action_type] ?? { icon: '\u2022', color: '#888', label: action.action_type };
				return (
					<div
						key={action.id}
						style={{
							display: 'flex',
							alignItems: 'flex-start',
							gap: '10px',
							padding: '8px 12px',
							borderLeft: `3px solid ${config.color}`,
							background: 'var(--bg-tertiary)',
							borderRadius: '0 6px 6px 0',
						}}
					>
						<span style={{ fontSize: '16px', flexShrink: 0, marginTop: '1px' }}>{config.icon}</span>
						{action.actor_avatar && (
							<img
								src={action.actor_avatar}
								alt=""
								style={{ width: '22px', height: '22px', borderRadius: '50%', flexShrink: 0, marginTop: '1px' }}
							/>
						)}
						<div style={{ flex: 1, minWidth: 0 }}>
							<span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)' }}>
								{action.actor_username}
							</span>{' '}
							<span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
								{formatAction(action, users)}
							</span>
						</div>
						<span style={{ fontSize: '11px', color: 'var(--text-muted)', flexShrink: 0, marginTop: '2px' }}>
							{formatTime(action.created_at)}
						</span>
					</div>
				);
			})}
			<div ref={bottomRef} />
		</div>
	);
}
