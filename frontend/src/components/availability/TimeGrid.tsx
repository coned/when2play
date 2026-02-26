import { useState, useMemo } from 'preact/hooks';

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

	const otherUsers = useMemo(() => {
		const map = new Map<string, Set<string>>();
		for (const slot of allSlots) {
			if (slot.user_id === userId) continue;
			if (!map.has(slot.start_time)) map.set(slot.start_time, new Set());
			map.get(slot.start_time)!.add(slot.user_id);
		}
		return map;
	}, [allSlots, userId]);

	const toggleSlot = (time: string, forceValue?: boolean) => {
		setSelected((prev) => {
			const next = new Set(prev);
			const shouldAdd = forceValue ?? !next.has(time);
			if (shouldAdd) next.add(time);
			else next.delete(time);
			return next;
		});
	};

	const handleSave = () => {
		const slots = allTimeSlots.filter((s) => selected.has(s.start_time));
		onSave(slots);
	};

	// Group by hour for display (show 6am-2am range)
	const displaySlots = allTimeSlots.filter((s) => {
		const hour = parseInt(s.start_time.split(':')[0]);
		return hour >= 6 || hour < 2;
	});

	return (
		<div>
			<div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '12px' }}>
				<button class="btn btn-primary" onClick={handleSave}>
					Save
				</button>
			</div>

			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '2px' }}>
				{displaySlots.map((slot) => {
					const isSelected = selected.has(slot.start_time);
					const others = otherUsers.get(slot.start_time);
					const overlapCount = others ? others.size : 0;

					return (
						<div
							key={slot.start_time}
							onMouseDown={() => {
								setIsDragging(true);
								setDragValue(!isSelected);
								toggleSlot(slot.start_time);
							}}
							onMouseEnter={() => {
								if (isDragging) toggleSlot(slot.start_time, dragValue);
							}}
							onMouseUp={() => setIsDragging(false)}
							style={{
								padding: '4px 8px',
								fontSize: '11px',
								textAlign: 'center',
								cursor: 'pointer',
								userSelect: 'none',
								borderRadius: '4px',
								background: isSelected
									? overlapCount > 0
										? 'var(--success)'
										: 'var(--accent)'
									: overlapCount > 0
										? 'rgba(34, 197, 94, 0.2)'
										: 'var(--bg-tertiary)',
								color: isSelected ? '#fff' : 'var(--text-secondary)',
								border: `1px solid ${isSelected ? 'transparent' : 'var(--border)'}`,
								position: 'relative',
							}}
						>
							{slot.start_time}
							{overlapCount > 0 && (
								<span
									style={{
										position: 'absolute',
										top: '2px',
										right: '4px',
										fontSize: '9px',
										color: isSelected ? '#fff' : 'var(--success)',
									}}
								>
									+{overlapCount}
								</span>
							)}
						</div>
					);
				})}
			</div>

			<p class="text-muted" style={{ fontSize: '12px', marginTop: '8px' }}>
				Click or drag to select time slots. Green = overlap with others. Numbers show how many others are available.
			</p>
		</div>
	);
}
