import { useState, useMemo, useRef, useEffect, useCallback } from 'preact/hooks';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { formatLocalTime } from '../../lib/time';

interface TimeGridProps {
	date: string;
	mySlots: any[];
	allSlots: any[];
	userId: string;
	onSave: (slots: Array<{ start_time: string; end_time: string }>) => Promise<void>;
	isToday?: boolean;
	availStartHourET?: number;
	availEndHourET?: number;
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

/** Convert an ET hour to a UTC HH:MM slot for a given date, accounting for DST. */
function etHourToUtcSlot(etHour: number, dateStr: string): string {
	// Build a date in America/New_York at the given hour
	// We use a trial-and-error approach: construct UTC, then check what ET hour it maps to
	// Start with a rough estimate (ET is UTC-5 or UTC-4)
	const estimateUtcHour = (etHour + 5) % 24;
	const trial = new Date(`${dateStr}T${String(estimateUtcHour).padStart(2, '0')}:00:00Z`);

	// Get the actual ET hour for this UTC time
	const etStr = trial.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false });
	const actualEtHour = parseInt(etStr, 10) % 24;

	// Adjust if needed
	const diff = ((etHour - actualEtHour) % 24 + 24) % 24;
	if (diff !== 0) {
		trial.setUTCHours(trial.getUTCHours() + diff);
	}

	const h = trial.getUTCHours();
	const m = trial.getUTCMinutes();
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

interface FilteredSlot {
	start_time: string;
	end_time: string;
	dateOffset: 0 | 1;
}

/** Generate only slots within the ET time range for a given date, with dateOffset for midnight-crossing. */
function generateFilteredSlots(startHourET: number, endHourET: number, dateStr: string): FilteredSlot[] {
	const startUtc = etHourToUtcSlot(startHourET, dateStr);
	const endUtc = etHourToUtcSlot(endHourET, dateStr);

	const startIdx = ALL_SLOTS.findIndex((s) => s.start_time === startUtc);
	if (startIdx === -1) return ALL_SLOTS.map((s) => ({ ...s, dateOffset: 0 as const }));

	const endIdx = ALL_SLOTS.findIndex((s) => s.start_time === endUtc);
	if (endIdx === -1) return ALL_SLOTS.map((s) => ({ ...s, dateOffset: 0 as const }));

	if (endIdx > startIdx) {
		return ALL_SLOTS.slice(startIdx, endIdx).map((s) => ({ ...s, dateOffset: 0 as const }));
	}
	// Wraps around midnight: slots from startIdx onward are day 0, slots from 0 to endIdx are day 1
	return [
		...ALL_SLOTS.slice(startIdx).map((s) => ({ ...s, dateOffset: 0 as const })),
		...ALL_SLOTS.slice(0, endIdx).map((s) => ({ ...s, dateOffset: 1 as const })),
	];
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export function TimeGrid({ date, mySlots, allSlots, userId, onSave, isToday = true, availStartHourET, availEndHourET }: TimeGridProps) {
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

	// Use filtered slots if time range is configured
	const filteredSlots = useMemo((): FilteredSlot[] => {
		if (availStartHourET !== undefined && availEndHourET !== undefined) {
			return generateFilteredSlots(availStartHourET, availEndHourET, date);
		}
		return ALL_SLOTS.map((s) => ({ ...s, dateOffset: 0 as const }));
	}, [availStartHourET, availEndHourET, date]);

	// Measure available height after mount
	useEffect(() => {
		if (containerRef.current) {
			const rect = containerRef.current.getBoundingClientRect();
			const bottomPad = isMobile ? 80 : 24;
			const available = Math.max(200, window.innerHeight - rect.top - bottomPad);
			setContainerHeight(available);
		}
	}, [isMobile]);

	// Debounced auto-save when selected changes (5 second debounce)
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
		}, 5000);

		return () => {
			if (saveTimer.current) clearTimeout(saveTimer.current);
		};
	}, [selected]);

	// Always start from index 0 — past slots remain visible (dimmed + strikethrough)
	const startIndex = 0;

	const nextDate = useMemo(() => getNextDate(date), [date]);
	const numColumns = isMobile ? 2 : 3;
	const slotsPerColumn = Math.max(4, Math.floor((containerHeight - 28) / SLOT_HEIGHT));
	const totalSlots = Math.min(numColumns * slotsPerColumn, filteredSlots.length);

	// Current UTC time for past-slot detection
	const nowUtcMin = useMemo(() => {
		const now = new Date();
		return now.getUTCHours() * 60 + now.getUTCMinutes();
	}, []);

	// Build visible slots, using dateOffset for correct date on midnight-crossing ranges
	const visibleSlots = useMemo(() => {
		const total = filteredSlots.length;
		return Array.from({ length: totalSlots }, (_, i) => {
			const raw = startIndex + i;
			const wrapped = raw % total;
			const slot = filteredSlots[wrapped];
			// dateOffset=1 means this slot is already next-day in the filtered range;
			// wrapping past total adds another day
			const slotDate = (slot.dateOffset > 0 || raw >= total) ? nextDate : date;
			return { ...slot, slotDate };
		});
	}, [startIndex, totalSlots, date, nextDate, filteredSlots]);

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

	const formatDateLabel = (dateStr: string): string => {
		const d = new Date(dateStr + 'T12:00:00Z');
		return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	};

	const colTimeRange = (col: typeof visibleSlots) => {
		if (col.length === 0) return '';
		const firstDate = col[0].slotDate;
		const dateLabel = formatDateLabel(firstDate);
		const first = formatLocalTime(col[0].start_time, col[0].slotDate);
		const last = formatLocalTime(col[col.length - 1].start_time, col[col.length - 1].slotDate);
		return `${dateLabel}: ${first} – ${last}`;
	};

	const isSlotPast = (slotTime: string, slotDate: string): boolean => {
		if (!isToday || slotDate !== date) return false;
		const [h, m] = slotTime.split(':').map(Number);
		return h * 60 + m < nowUtcMin;
	};

	const statusText = saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? '✓ Saved' : saveStatus === 'error' ? 'Save failed' : '';
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
							const isPast = isSlotPast(slot.start_time, slot.slotDate);

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
										opacity: isPast ? 0.45 : 1,
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
											textDecoration: isPast ? 'line-through' : 'none',
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
