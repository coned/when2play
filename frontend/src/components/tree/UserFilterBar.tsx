import type { Participant } from './treeConstants';
import { ANONYMOUS_ID, getInitials, truncate } from './treeConstants';

interface UserFilterBarProps {
	participantIds: string[];
	participants: Record<string, Participant>;
	filterUserIds: Set<string>;
	onToggle: (userId: string) => void;
	onClear: () => void;
}

export function UserFilterBar({ participantIds, participants, filterUserIds, onToggle, onClear }: UserFilterBarProps) {
	if (participantIds.length === 0) return null;

	const hasFilters = filterUserIds.size > 0;

	return (
		<div style={{
			display: 'flex',
			alignItems: 'center',
			gap: '6px',
			padding: '8px 0',
			overflowX: 'auto',
			WebkitOverflowScrolling: 'touch',
		}}>
			{participantIds.map((id) => {
				const isAnon = id === ANONYMOUS_ID;
				const p = isAnon ? null : participants[id];
				const name = isAnon ? 'Anonymous' : (p?.username ?? 'Unknown');
				const avatar = isAnon ? null : p?.avatar;
				const active = filterUserIds.has(id);

				return (
					<button
						key={id}
						onClick={() => onToggle(id)}
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: '5px',
							padding: '4px 10px',
							minHeight: '32px',
							minWidth: '44px',
							borderRadius: '16px',
							border: active ? '2px solid var(--accent)' : '1px solid var(--border)',
							background: active ? 'var(--accent-bg, rgba(74,158,255,0.15))' : 'var(--bg-tertiary)',
							color: 'var(--text-primary)',
							fontSize: '12px',
							fontWeight: active ? 700 : 500,
							cursor: 'pointer',
							flexShrink: 0,
							opacity: hasFilters && !active ? 0.5 : 1,
							transition: 'opacity 0.15s, border-color 0.15s',
						}}
					>
						{avatar ? (
							<img src={avatar} alt="" style={{ width: '20px', height: '20px', borderRadius: '50%' }} />
						) : (
							<span style={{
								width: '20px',
								height: '20px',
								borderRadius: '50%',
								background: isAnon ? '#666' : 'var(--bg-secondary)',
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								fontSize: '9px',
								fontWeight: 700,
								color: 'var(--text-secondary)',
								flexShrink: 0,
							}}>
								{getInitials(name)}
							</span>
						)}
						{truncate(name, 10)}
					</button>
				);
			})}
			{hasFilters && (
				<button
					onClick={onClear}
					style={{
						padding: '4px 10px',
						minHeight: '32px',
						minWidth: '44px',
						borderRadius: '16px',
						border: '1px solid var(--border)',
						background: 'var(--bg-tertiary)',
						color: 'var(--text-muted)',
						fontSize: '11px',
						cursor: 'pointer',
						flexShrink: 0,
					}}
				>
					Clear
				</button>
			)}
		</div>
	);
}
