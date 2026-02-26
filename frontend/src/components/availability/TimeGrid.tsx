import { useState, useMemo, useRef, useCallback } from 'preact/hooks';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { utcToLocal } from '../../lib/time';

interface TimeGridProps {
	date: string;
	mySlots: any[];
	allSlots: any[];
	userId: string;
	onSave: (slots: Array<{ start_time: string; end_time: string }>) => void;
}

function generateHourSlots(granularity: number = 15) {
	const slots: Array<{ start_time: string; end_time: string }> = [];
	for (let hour = 0; hour < 24; hour++) {
		for (let min = 0; min < 60; min += granularity) {
			const nextMin = min + granularity;
			const nextHour = nextMin >= 60 ? hour + 1 : hour;
			const endMin = nextMin % 60;
			slots.push({
				start_time: `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
				end_time: `${String(nextHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`,
			});
		}
	}
	return slots;
}

export function TimeGrid({ date, mySlots, allSlots, userId, onSave }: TimeGridProps) {
	const allTimeSlots = useMemo(() => generateHourSlots(), []);
	const [selected, setSelected] = useState<Set<string>>(
		new Set(mySlots.map((s) => s.start_time)),
	);
	const [isDragging, setIsDragging] = useState(false);
	const [dragValue, setDragValue] = useState(true);
	const [touchMode, setTouchMode] = useState<'select' | 'scroll'>('scroll');
	const gridRef = useRef<HTMLDivElement>(null);
	const isMobile = useMediaQuery(768);

	const otherUsers = useMemo(() => {
		const map = new Map<string, Set<string>>();
		for (const slot of allSlots) {
			if (slot.user_id === userId) continue;
			if (!map.has(slot.start_time)) map.set(slot.start_time, new Set());
			map.get(slot.start_time)!.add(slot.user_id);
		}
		return map;
	}, [allSlots, userId]);

	const toggleSlot = useCallback((time: string, forceValue?: boolean) => {
		setSelected((prev) => {
			const next = new Set(prev);
			const shouldAdd = forceValue ?? !next.has(time);
			if (shouldAdd) next.add(time);
			else next.delete(time);
			return next;
		});
	}, []);

	const handleSave = () => {
		const slots = allTimeSlots.filter((s) => selected.has(s.start_time));
		onSave(slots);
	};

	const handleTouchStart = (time: string, isSelected: boolean) => {
		if (touchMode !== 'select') return;
		setIsDragging(true);
		setDragValue(!isSelected);
		toggleSlot(time);
	};

	const handleTouchMove = (e: TouchEvent) => {
		if (!isDragging || touchMode !== 'select') return;
		e.preventDefault();
		const touch = e.touches[0];
		const el = document.elementFromPoint(touch.clientX, touch.clientY);
		const time = el?.getAttribute('data-time');
		if (time) toggleSlot(time, dragValue);
	};

	const handleTouchEnd = () => {
		setIsDragging(false);
	};

	// Show 6am-2am range
	const displaySlots = allTimeSlots.filter((s) => {
		const hour = parseInt(s.start_time.split(':')[0]);
		return hour >= 6 || hour < 2;
	});

	// Group by hour
	const hourGroups = useMemo(() => {
		const groups: Array<{ hour: string; slots: typeof displaySlots }> = [];
		let currentHour = '';
		for (const slot of displaySlots) {
			const hour = slot.start_time.split(':')[0];
			if (hour !== currentHour) {
				currentHour = hour;
				groups.push({ hour: `${hour}:00`, slots: [] });
			}
			groups[groups.length - 1].slots.push(slot);
		}
		return groups;
	}, [displaySlots]);

	return (
		<div>
			<div style={{
				display: 'flex',
				justifyContent: 'space-between',
				alignItems: 'center',
				marginBottom: '12px',
				position: 'sticky',
				top: 0,
				background: 'var(--bg-primary)',
				padding: '8px 0',
				zIndex: 10,
			}}>
				<div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
					{isMobile && (
						<button
							class={`btn ${touchMode === 'select' ? 'btn-primary' : 'btn-secondary'}`}
							style={{ fontSize: '12px', padding: '4px 10px' }}
							onClick={() => setTouchMode(touchMode === 'select' ? 'scroll' : 'select')}
						>
							{touchMode === 'select' ? 'Select mode' : 'Scroll mode'}
						</button>
					)}
				</div>
				<button class="btn btn-primary" onClick={handleSave}>
					Save
				</button>
			</div>

			<div
				ref={gridRef}
				onMouseUp={() => setIsDragging(false)}
				onMouseLeave={() => setIsDragging(false)}
				onTouchMove={handleTouchMove}
				onTouchEnd={handleTouchEnd}
				style={{
					display: 'flex',
					flexDirection: 'column',
					gap: '1px',
					touchAction: touchMode === 'select' ? 'none' : 'auto',
				}}
			>
				{hourGroups.map((group) => (
					<div key={group.hour}>
						<div style={{
							padding: '8px 0 4px',
							fontSize: '13px',
							fontWeight: 700,
							color: 'var(--text-secondary)',
							borderBottom: '1px solid var(--border)',
							marginBottom: '2px',
						}}>
							{group.hour} UTC / {utcToLocal(group.hour, date)}
						</div>
						{group.slots.map((slot) => {
							const isSelected = selected.has(slot.start_time);
							const others = otherUsers.get(slot.start_time);
							const overlapCount = others ? others.size : 0;

							return (
								<div
									key={slot.start_time}
									data-time={slot.start_time}
									onMouseDown={() => {
										setIsDragging(true);
										setDragValue(!isSelected);
										toggleSlot(slot.start_time);
									}}
									onMouseEnter={() => {
										if (isDragging) toggleSlot(slot.start_time, dragValue);
									}}
									onTouchStart={() => handleTouchStart(slot.start_time, isSelected)}
									style={{
										display: 'flex',
										alignItems: 'center',
										gap: '12px',
										padding: '6px 12px',
										cursor: 'pointer',
										userSelect: 'none',
										borderRadius: '4px',
										marginBottom: '1px',
										background: isSelected
											? overlapCount > 0
												? 'var(--success)'
												: 'var(--accent)'
											: overlapCount > 0
												? 'rgba(34, 197, 94, 0.15)'
												: 'var(--bg-tertiary)',
										color: isSelected ? '#fff' : 'var(--text-secondary)',
									}}
								>
									<span style={{ minWidth: '120px', fontSize: '13px' }}>
										{slot.start_time} / {utcToLocal(slot.start_time, date)}
									</span>
									<div style={{
										flex: 1,
										height: '8px',
										borderRadius: '4px',
										background: isSelected
											? 'rgba(255,255,255,0.3)'
											: 'var(--border)',
									}} />
									{overlapCount > 0 && (
										<span style={{
											fontSize: '12px',
											fontWeight: 600,
											color: isSelected ? '#fff' : 'var(--success)',
										}}>
											+{overlapCount}
										</span>
									)}
								</div>
							);
						})}
					</div>
				))}
			</div>

			<p class="text-muted" style={{ fontSize: '12px', marginTop: '8px' }}>
				{isMobile
					? 'Toggle "Select mode" to tap/drag time slots. Green = overlap with others.'
					: 'Click or drag to select time slots. Green = overlap with others.'
				}
			</p>
		</div>
	);
}
