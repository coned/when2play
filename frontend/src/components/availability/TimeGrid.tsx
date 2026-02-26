import { useState, useMemo, useRef, useEffect, useCallback } from 'preact/hooks';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { formatLocalTime } from '../../lib/time';

interface TimeGridProps {
	date: string;
	mySlots: any[];
	allSlots: any[];
	userId: string;
	onSave: (slots: Array<{ start_time: string; end_time: string }>) => Promise<void>;
}

const GRANULARITY = 15;
const SLOT_HEIGHT = 34;

function generateSlots() {
	const slots: Array<{ start_time: string; end_time: string }> = [];
	for (let hour = 0; hour < 24; hour++) {
		for (let min = 0; min < 60; min += GRANULARITY) {
			const nextMin = min + GRANULARITY;
			const nextHour = nextMin >= 60 ? hour + 1 : hour;
			slots.push({
				start_time: `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
				end_time: `${String(nextHour % 24).padStart(2, '0')}:${String(nextMin % 60).padStart(2, '0')}`,
			});
		}
	}
	return slots;
}

const ALL_SLOTS = generateSlots();

function getNextDate(dateStr: string): string {
	const d = new Date(dateStr + 'T12:00:00Z');
	d.setUTCDate(d.getUTCDate() + 1);
	return d.toISOString().split('T')[0];
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export function TimeGrid({ date, mySlots, allSlots, userId, onSave }: TimeGridProps) {
	const [selected, setSelected] = useState<Set<string>>(new Set(mySlots.map((s) => s.start_time)));
	const [isDragging, setIsDragging] = useState(false);
	const [dragValue, setDragValue] = useState(true);
	const [touchMode, setTouchMode] = useState<'select' | 'scroll'>('scroll');
	const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
	const containerRef = useRef<HTMLDivElement>(null);
	const [containerHeight, setContainerHeight] = useState(400);
	const isMobile = useMediaQuery(768);
	const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const isFirstRender = useRef(true);

	// Measure available height after mount
	useEffect(() => {
		if (containerRef.current) {
			const rect = containerRef.current.getBoundingClientRect();
			const bottomPad = isMobile ? 80 : 24;
			const available = Math.max(200, window.innerHeight - rect.top - bottomPad);
			setContainerHeight(available);
		}
	}, [isMobile]);

	// Debounced auto-save when selected changes
	useEffect(() => {
		if (isFirstRender.current) {
			isFirstRender.current = false;
			return;
		}
		setSaveStatus('saving');
		if (saveTimer.current) clearTimeout(saveTimer.current);
		if (clearTimer.current) clearTimeout(clearTimer.current);

		saveTimer.current = setTimeout(async () => {
			try {
				const slots = ALL_SLOTS.filter((s) => selected.has(s.start_time));
				await onSave(slots);
				setSaveStatus('saved');
				clearTimer.current = setTimeout(() => setSaveStatus('idle'), 2000);
			} catch {
				setSaveStatus('error');
				clearTimer.current = setTimeout(() => setSaveStatus('idle'), 3000);
			}
		}, 600);

		return () => {
			if (saveTimer.current) clearTimeout(saveTimer.current);
		};
	}, [selected]);

	// Find start slot index = current UTC time, rounded down to slot boundary
	const startIndex = useMemo(() => {
		const now = new Date();
		const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
		const slotMin = Math.floor(utcMin / GRANULARITY) * GRANULARITY;
		const h = Math.floor(slotMin / 60);
		const m = slotMin % 60;
		const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
		const idx = ALL_SLOTS.findIndex((s) => s.start_time === time);
		return Math.max(0, idx);
	}, []);

	const nextDate = useMemo(() => getNextDate(date), [date]);
	const numColumns = isMobile ? 2 : 3;
	const slotsPerColumn = Math.max(4, Math.floor((containerHeight - 28) / SLOT_HEIGHT));
	const totalSlots = numColumns * slotsPerColumn;

	// Build visible slots, wrapping around 24h boundary
	const visibleSlots = useMemo(() => {
		const total = ALL_SLOTS.length;
		return Array.from({ length: totalSlots }, (_, i) => {
			const raw = startIndex + i;
			const wrapped = raw % total;
			const slotDate = raw >= total ? nextDate : date;
			return { ...ALL_SLOTS[wrapped], slotDate };
		});
	}, [startIndex, totalSlots, date, nextDate]);

	const columns = useMemo(
		() => Array.from({ length: numColumns }, (_, i) => visibleSlots.slice(i * slotsPerColumn, (i + 1) * slotsPerColumn)),
		[visibleSlots, numColumns, slotsPerColumn],
	);

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

	const handleTouchMove = (e: TouchEvent) => {
		if (!isDragging || touchMode !== 'select') return;
		e.preventDefault();
		const touch = e.touches[0];
		const el = document.elementFromPoint(touch.clientX, touch.clientY);
		const time = el?.getAttribute('data-time');
		if (time) toggleSlot(time, dragValue);
	};

	const colTimeRange = (col: typeof visibleSlots) => {
		if (col.length === 0) return '';
		const first = formatLocalTime(col[0].start_time, col[0].slotDate);
		const last = formatLocalTime(col[col.length - 1].start_time, col[col.length - 1].slotDate);
		return `${first} – ${last}`;
	};

	const statusText = saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? '✓ Saved' : saveStatus === 'error' ? 'Save failed' : '';
	const statusColor = saveStatus === 'saved' ? 'var(--success)' : saveStatus === 'error' ? 'var(--danger)' : 'var(--text-muted)';

	return (
		<div>
			{/* Action bar */}
			<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
				<div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
					{isMobile && (
						<button
							class={`btn ${touchMode === 'select' ? 'btn-primary' : 'btn-secondary'}`}
							style={{ fontSize: '12px', padding: '4px 10px' }}
							onClick={() => setTouchMode(touchMode === 'select' ? 'scroll' : 'select')}
						>
							{touchMode === 'select' ? '✓ Select' : 'Select'}
						</button>
					)}
					<span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
						{isMobile ? 'Tap to toggle · drag to range' : 'Click or drag to select'}
					</span>
				</div>
				<span style={{ fontSize: '12px', color: statusColor, minWidth: '70px', textAlign: 'right' }}>
					{statusText}
				</span>
			</div>

			{/* Time columns */}
			<div
				ref={containerRef}
				onMouseUp={() => setIsDragging(false)}
				onMouseLeave={() => setIsDragging(false)}
				onTouchMove={handleTouchMove}
				onTouchEnd={() => setIsDragging(false)}
				style={{
					display: 'grid',
					gridTemplateColumns: `repeat(${numColumns}, 1fr)`,
					gap: '6px',
					height: `${containerHeight}px`,
					touchAction: touchMode === 'select' ? 'none' : 'auto',
					overflow: 'hidden',
				}}
			>
				{columns.map((col, ci) => (
					<div
						key={ci}
						style={{
							display: 'flex',
							flexDirection: 'column',
							gap: '1px',
							borderLeft: ci > 0 ? '1px solid var(--border)' : 'none',
							paddingLeft: ci > 0 ? '6px' : 0,
							overflow: 'hidden',
						}}
					>
						<div
							style={{
								fontSize: '10px',
								color: 'var(--text-muted)',
								paddingBottom: '3px',
								borderBottom: '1px solid var(--border)',
								marginBottom: '2px',
								whiteSpace: 'nowrap',
								overflow: 'hidden',
								textOverflow: 'ellipsis',
								flexShrink: 0,
							}}
						>
							{colTimeRange(col)}
						</div>

						{col.map((slot) => {
							const isSelected = selected.has(slot.start_time);
							const overlapCount = otherUsers.get(slot.start_time)?.size ?? 0;
							const isHourStart = slot.start_time.endsWith(':00');

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
									onTouchStart={() => {
										if (touchMode !== 'select') return;
										setIsDragging(true);
										setDragValue(!isSelected);
										toggleSlot(slot.start_time);
									}}
									style={{
										display: 'flex',
										alignItems: 'center',
										gap: '4px',
										padding: '0 4px',
										height: `${SLOT_HEIGHT}px`,
										cursor: 'pointer',
										userSelect: 'none',
										borderRadius: '3px',
										flexShrink: 0,
										background: isSelected
											? overlapCount > 0
												? 'var(--success)'
												: 'var(--accent)'
											: overlapCount > 0
												? 'rgba(34, 197, 94, 0.15)'
												: isHourStart
													? 'var(--bg-card)'
													: 'var(--bg-tertiary)',
										color: isSelected ? '#fff' : 'var(--text-secondary)',
										borderTop: isHourStart ? '1px solid var(--border)' : 'none',
									}}
								>
									<span
										style={{
											flex: 1,
											fontSize: '12px',
											fontVariantNumeric: 'tabular-nums',
											whiteSpace: 'nowrap',
											overflow: 'hidden',
											textOverflow: 'ellipsis',
											fontWeight: isHourStart ? 600 : 400,
										}}
									>
										{formatLocalTime(slot.start_time, slot.slotDate)}
									</span>
									{overlapCount > 0 && (
										<span
											style={{
												fontSize: '10px',
												fontWeight: 700,
												color: isSelected ? '#fff' : 'var(--success)',
												flexShrink: 0,
											}}
										>
											+{overlapCount}
										</span>
									)}
								</div>
							);
						})}
					</div>
				))}
			</div>
			<p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
				Changes save automatically · Green = overlap with others
			</p>
		</div>
	);
}
