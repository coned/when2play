import type { AvailabilityStatusMap } from '@when2play/shared';

interface DateStripProps {
	dates: string[];
	selectedDate: string;
	statusMap: AvailabilityStatusMap;
	onSelect: (date: string) => void;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function ConfidenceDot({ status }: { status: 'tentative' | 'confirmed' | 'manual' | null }) {
	const size = 8;

	if (status === 'confirmed' || status === 'manual') {
		return (
			<span
				style={{
					display: 'inline-block',
					width: `${size}px`,
					height: `${size}px`,
					borderRadius: '50%',
					background: 'var(--accent)',
				}}
			/>
		);
	}

	if (status === 'tentative') {
		// Half-filled amber dot using a gradient
		return (
			<span
				style={{
					display: 'inline-block',
					width: `${size}px`,
					height: `${size}px`,
					borderRadius: '50%',
					background: `linear-gradient(to top, var(--warning) 50%, transparent 50%)`,
					border: '1px solid var(--warning)',
					boxSizing: 'border-box',
				}}
			/>
		);
	}

	// null - empty outline
	return (
		<span
			style={{
				display: 'inline-block',
				width: `${size}px`,
				height: `${size}px`,
				borderRadius: '50%',
				border: '1px solid var(--text-muted)',
				boxSizing: 'border-box',
			}}
		/>
	);
}

export function DateStrip({ dates, selectedDate, statusMap, onSelect }: DateStripProps) {
	const todayStr = dates[0]; // first date is always "today"

	return (
		<div
			style={{
				display: 'flex',
				gap: '4px',
				overflowX: 'auto',
				paddingBottom: '4px',
				WebkitOverflowScrolling: 'touch',
				scrollbarWidth: 'none',
			}}
		>
			{dates.map((date) => {
				const d = new Date(date + 'T12:00:00Z');
				const dayName = DAY_NAMES[d.getUTCDay()];
				const dayNum = d.getUTCDate();
				const isSelected = date === selectedDate;
				const isToday = date === todayStr;
				const status = statusMap[date] ?? null;

				return (
					<button
						key={date}
						onClick={() => onSelect(date)}
						style={{
							display: 'flex',
							flexDirection: 'column',
							alignItems: 'center',
							gap: '2px',
							minWidth: '44px',
							padding: '6px 4px',
							border: isSelected ? '2px solid var(--accent)' : '1px solid var(--border)',
							borderRadius: '8px',
							background: isSelected ? 'var(--bg-tertiary)' : 'transparent',
							cursor: 'pointer',
							color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
							flexShrink: 0,
						}}
					>
						<span style={{
							fontSize: '10px',
							fontWeight: isToday ? 700 : 500,
							color: isToday ? 'var(--accent)' : 'inherit',
							lineHeight: 1,
						}}>
							{isToday ? 'Today' : dayName}
						</span>
						<span style={{
							fontSize: '16px',
							fontWeight: 600,
							lineHeight: 1.2,
						}}>
							{dayNum}
						</span>
						<ConfidenceDot status={status} />
					</button>
				);
			})}
		</div>
	);
}
