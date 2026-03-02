import { useState, useEffect } from 'preact/hooks';
import { api } from '../../api/client';

const ACTION_LABELS: Record<string, string> = {
	propose: 'proposed',
	like: 'liked',
	dislike: 'disliked',
	unreact: 'removed reaction from',
	archive: 'archived',
	restore: 'restored',
};

function relativeTime(isoDate: string): string {
	const diff = Date.now() - new Date(isoDate).getTime();
	const mins = Math.floor(diff / 60000);
	if (mins < 1) return 'just now';
	if (mins < 60) return `${mins}m ago`;
	const hrs = Math.floor(mins / 60);
	if (hrs < 24) return `${hrs}h ago`;
	const days = Math.floor(hrs / 24);
	return `${days}d ago`;
}

function formatDetail(action: string, detail: string | null): string {
	if (action === 'archive' && detail) {
		try {
			const parsed = JSON.parse(detail);
			if (parsed.reason) return ` (${parsed.reason.replace(/_/g, ' ')})`;
		} catch { /* ignore */ }
	}
	return '';
}

const PAGE_SIZE = 30;

export function GameActivity() {
	const [entries, setEntries] = useState<any[]>([]);
	const [loading, setLoading] = useState(true);
	const [loadingMore, setLoadingMore] = useState(false);
	const [hasMore, setHasMore] = useState(true);

	useEffect(() => {
		(async () => {
			const result = await api.getGameActivity(PAGE_SIZE);
			if (result.ok) {
				setEntries(result.data);
				setHasMore(result.data.length === PAGE_SIZE);
			}
			setLoading(false);
		})();
	}, []);

	const loadMore = async () => {
		if (loadingMore || entries.length === 0) return;
		setLoadingMore(true);
		const last = entries[entries.length - 1];
		const result = await api.getGameActivity(PAGE_SIZE, last.created_at);
		if (result.ok) {
			setEntries((prev) => [...prev, ...result.data]);
			setHasMore(result.data.length === PAGE_SIZE);
		}
		setLoadingMore(false);
	};

	if (loading) return <div class="spinner" style={{ margin: '20px auto' }} />;
	if (entries.length === 0) return null;

	return (
		<div>
			<h3 style={{ marginBottom: '12px' }}>Recent Activity</h3>
			<div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
				{entries.map((entry) => {
					const userName = entry.user_display_name || entry.discord_username;
					const verb = ACTION_LABELS[entry.action] || entry.action;
					const extra = formatDetail(entry.action, entry.detail);
					return (
						<div
							key={entry.id}
							style={{
								display: 'flex',
								justifyContent: 'space-between',
								alignItems: 'center',
								padding: '6px 0',
								fontSize: '13px',
								color: 'var(--text-secondary)',
								borderBottom: '1px solid var(--border)',
							}}
						>
							<span>
								<strong style={{ color: 'var(--text-primary)' }}>{userName}</strong>{' '}
								{verb}{extra}{' '}
								<strong style={{ color: 'var(--text-primary)' }}>{entry.game_name}</strong>
							</span>
							<span class="text-muted" style={{ fontSize: '12px', flexShrink: 0, marginLeft: '8px' }}>
								{relativeTime(entry.created_at)}
							</span>
						</div>
					);
				})}
			</div>
			{hasMore && (
				<button
					class="btn btn-secondary"
					style={{ marginTop: '12px', fontSize: '12px', padding: '6px 16px' }}
					onClick={loadMore}
					disabled={loadingMore}
				>
					{loadingMore ? 'Loading...' : 'Show more'}
				</button>
			)}
		</div>
	);
}
