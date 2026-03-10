import { useEffect, useRef, useCallback } from 'preact/hooks';
import type { TreeNode, Participant } from './treeConstants';
import {
	getNodeColor,
	getNodeIcon,
	getNodeLabel,
	formatTime,
	isAnonymous,
} from './treeConstants';

interface NodeDetailPanelProps {
	node: TreeNode;
	participants: Record<string, Participant>;
	onClose: () => void;
}

export function NodeDetailPanel({ node, participants, onClose }: NodeDetailPanelProps) {
	const panelRef = useRef<HTMLDivElement>(null);

	// Close on Escape
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose();
		};
		document.addEventListener('keydown', handler);
		return () => document.removeEventListener('keydown', handler);
	}, [onClose]);

	// Close on click outside
	const handleBackdropClick = useCallback((e: MouseEvent) => {
		if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
			onClose();
		}
	}, [onClose]);

	const color = getNodeColor(node.action_type);
	const icon = getNodeIcon(node.action_type);
	const label = getNodeLabel(node.action_type);
	const anon = isAnonymous(node);
	const actor = anon ? null : participants[node.actor_id];

	// Render metadata details
	const renderMetadata = () => {
		if (!node.metadata) return null;

		if (node.action_type === 'judge_time') {
			const meta = node.metadata as { windows?: Array<{ start: string; end: string; user_count: number; user_names?: string[] }>; day_key?: string };
			if (!meta.windows?.length) return <p style={{ color: 'var(--text-muted)', fontSize: '12px' }}>No overlapping availability found</p>;

			const toLocal = (t: string) => {
				if (!meta.day_key) return t;
				try {
					return new Date(`${meta.day_key}T${t}:00Z`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
				} catch { return t; }
			};

			return (
				<div style={{ marginTop: '8px' }}>
					<div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>Best Windows</div>
					{meta.windows.slice(0, 5).map((w, i) => (
						<div key={i} style={{ fontSize: '12px', color: 'var(--text-primary)', padding: '2px 0' }}>
							{toLocal(w.start)} - {toLocal(w.end)} ({w.user_count} users{w.user_names ? `: ${w.user_names.join(', ')}` : ''})
						</div>
					))}
				</div>
			);
		}

		if (node.action_type === 'share_ranking') {
			const meta = node.metadata as { ranking?: Array<{ name: string; total_score: number; vote_count: number }> };
			if (!meta.ranking?.length) return null;
			return (
				<div style={{ marginTop: '8px' }}>
					<div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>Top Games</div>
					{meta.ranking.slice(0, 5).map((r, i) => (
						<div key={i} style={{ fontSize: '12px', color: 'var(--text-primary)', padding: '2px 0' }}>
							#{i + 1} {r.name} ({r.total_score} pts)
						</div>
					))}
				</div>
			);
		}

		return null;
	};

	// Resolve target user names
	const targetNames = node.target_user_ids
		?.map((id) => participants[id]?.username ?? 'Unknown')
		.join(', ');

	return (
		<div
			onClick={handleBackdropClick}
			style={{
				position: 'absolute',
				inset: 0,
				zIndex: 20,
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
			}}
		>
			<div
				ref={panelRef}
				style={{
					background: 'var(--bg-secondary)',
					border: `2px solid ${color}`,
					borderRadius: '12px',
					padding: '16px 20px',
					maxWidth: '360px',
					width: '90%',
					boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
				}}
			>
				{/* Header */}
				<div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
					{!anon && actor?.avatar && (
						<img src={actor.avatar} alt="" style={{ width: '32px', height: '32px', borderRadius: '50%' }} />
					)}
					<div style={{ flex: 1, minWidth: 0 }}>
						<div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text-primary)' }}>
							{anon ? 'Anonymous' : (actor?.username ?? node.actor_username)}
						</div>
						<div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
							{formatTime(node.created_at)}
						</div>
					</div>
					<span style={{ fontSize: '20px' }}>{icon}</span>
				</div>

				{/* Action type badge */}
				<div style={{
					display: 'inline-block',
					padding: '2px 10px',
					borderRadius: '12px',
					fontSize: '11px',
					fontWeight: 700,
					color: 'white',
					background: color,
					marginBottom: '10px',
				}}>
					{label}
				</div>

				{/* Message */}
				{node.message && (
					<div style={{
						padding: '8px 10px',
						background: 'var(--bg-tertiary)',
						borderRadius: '6px',
						fontSize: '13px',
						color: 'var(--text-primary)',
						lineHeight: '1.4',
						marginBottom: '8px',
						wordBreak: 'break-word',
					}}>
						{node.message}
					</div>
				)}

				{/* Target users */}
				{targetNames && (
					<div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
						<strong>Targets:</strong> {targetNames}
					</div>
				)}

				{/* Metadata */}
				{renderMetadata()}

				{/* Close hint */}
				<div style={{ marginTop: '12px', fontSize: '10px', color: 'var(--text-muted)', textAlign: 'center' }}>
					Click outside or press Esc to close
				</div>
			</div>
		</div>
	);
}
