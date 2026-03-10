import { useState, useMemo, useRef, useEffect, useCallback } from 'preact/hooks';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { formatLocalTimeClean } from '../../lib/time';

import type { AvailabilityStatus } from '@when2play/shared';

interface TimeGridProps {
	date: string;
	mySlots: any[];
	allSlots: any[];
	userId: string;
	onSave: (slots: Array<{ start_time: string; end_time: string; slot_status?: string }>) => Promise<void>;
	availStartHourET?: number;
	availEndHourET?: number;
	totalGuildUsers: number;
	userMap: Map<string, { display_name: string | null; avatar_url: string | null }>;
	dateStatus?: AvailabilityStatus | null;
	onConfirm?: () => Promise<void>;
}

const GRANULARITY = 15;
const SLOT_HEIGHT = 34;
const MAX_INLINE_AVATARS = 4;

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
	const estimateUtcHour = (etHour + 5) % 24;
	const trial = new Date(`${dateStr}T${String(estimateUtcHour).padStart(2, '0')}:00:00Z`);

	const etStr = trial.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false });
	const actualEtHour = parseInt(etStr, 10) % 24;

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
	return [
		...ALL_SLOTS.slice(startIdx).map((s) => ({ ...s, dateOffset: 0 as const })),
		...ALL_SLOTS.slice(0, endIdx).map((s) => ({ ...s, dateOffset: 1 as const })),
	];
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface Voter {
	userId: string;
	status: string;
	slotStatus: string;
}

function voterDotStyle(voter: Voter): Record<string, string | number> {
	if (voter.status === 'tentative') {
		// Auto-filled from last week: hollow dot with dashed gray border
		return {
			width: '10px', height: '10px', borderRadius: '50%',
			border: '2px dashed var(--text-muted)', background: 'transparent',
			flexShrink: 0, boxSizing: 'border-box',
		};
	}
	if (voter.slotStatus === 'tentative') {
		// Explicitly tentative: solid amber dot
		return {
			width: '10px', height: '10px', borderRadius: '50%',
			background: 'var(--warning)', flexShrink: 0,
		};
	}
	// Available: solid green dot
	return {
		width: '10px', height: '10px', borderRadius: '50%',
		background: 'var(--success)', flexShrink: 0,
	};
}

function voterRingStyle(voter: Voter): Record<string, string> {
	if (voter.status === 'tentative') {
		return { border: '2px dashed var(--text-muted)' };
	}
	if (voter.slotStatus === 'tentative') {
		return { border: '2px solid var(--warning)' };
	}
	return { border: '2px solid var(--success)' };
}

function SlotPopover({ voters, userMap }: { voters: Voter[]; userMap: Map<string, { display_name: string | null; avatar_url: string | null }> }) {
	const shown = voters.slice(0, 5);
	const overflow = voters.length - shown.length;

	return (
		<div
			style={{
				position: 'absolute',
				bottom: '100%',
				left: '50%',
				transform: 'translateX(-50%)',
				marginBottom: '4px',
				background: 'var(--bg-card)',
				border: '1px solid var(--border)',
				borderRadius: '6px',
				padding: '6px 10px',
				zIndex: 100,
				minWidth: '120px',
				maxWidth: '200px',
				boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
				pointerEvents: 'none',
			}}
		>
			<div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
				{shown.map((voter) => {
					const user = userMap.get(voter.userId);
					const name = user?.display_name ?? voter.userId.slice(0, 8);
					return (
						<div key={voter.userId} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
							{user?.avatar_url ? (
								<img
									src={user.avatar_url}
									alt={name}
									style={{
										width: '18px',
										height: '18px',
										borderRadius: '50%',
										flexShrink: 0,
									}}
								/>
							) : (
								<span
									style={{
										width: '18px',
										height: '18px',
										borderRadius: '50%',
										background: 'var(--accent)',
										display: 'flex',
										alignItems: 'center',
										justifyContent: 'center',
										fontSize: '9px',
										color: '#fff',
										flexShrink: 0,
									}}
								>
									{name[0].toUpperCase()}
								</span>
							)}
							<span style={voterDotStyle(voter)} />
							<span style={{ fontSize: '11px', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
								{name}
							</span>
						</div>
					);
				})}
				{overflow > 0 && (
					<span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
						+{overflow} more
					</span>
				)}
			</div>
		</div>
	);
}

function InlineAvatars({ voters, userMap }: { voters: Voter[]; userMap: Map<string, { display_name: string | null; avatar_url: string | null }> }) {
	const shown = voters.slice(0, MAX_INLINE_AVATARS);
	const overflow = voters.length - shown.length;

	return (
		<div style={{ display: 'flex', alignItems: 'center', flexShrink: 0, position: 'relative', zIndex: 1 }}>
			{shown.map((voter, i) => {
				const user = userMap.get(voter.userId);
				const name = user?.display_name ?? voter.userId.slice(0, 8);
				const ringStyle = voterRingStyle(voter);
				return (
					<div
						key={voter.userId}
						style={{
							width: '18px',
							height: '18px',
							borderRadius: '50%',
							...ringStyle,
							boxSizing: 'border-box',
							marginLeft: i > 0 ? '-5px' : '0',
							flexShrink: 0,
							overflow: 'hidden',
							background: 'var(--bg-card)',
							zIndex: MAX_INLINE_AVATARS - i,
							position: 'relative',
						}}
					>
						{user?.avatar_url ? (
							<img
								src={user.avatar_url}
								alt={name}
								style={{ width: '100%', height: '100%', display: 'block', borderRadius: '50%' }}
							/>
						) : (
							<span
								style={{
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'center',
									width: '100%',
									height: '100%',
									fontSize: '8px',
									fontWeight: 600,
									color: 'var(--text-muted)',
									background: 'var(--bg-tertiary)',
								}}
							>
								{name[0].toUpperCase()}
							</span>
						)}
					</div>
				);
			})}
			{overflow > 0 && (
				<span style={{ fontSize: '9px', fontWeight: 600, color: 'var(--text-muted)', marginLeft: '2px', flexShrink: 0, position: 'relative', zIndex: 1 }}>
					+{overflow}
				</span>
			)}
		</div>
	);
}

export function TimeGrid({ date, mySlots, allSlots, userId, onSave, availStartHourET, availEndHourET, totalGuildUsers, userMap, dateStatus, onConfirm }: TimeGridProps) {
	const isTentative = dateStatus === 'tentative';
	const [confirming, setConfirming] = useState(false);
	const [selected, setSelected] = useState<Map<string, 'available' | 'tentative'>>(
		new Map(mySlots.map((s: any) => [s.start_time, (s.slot_status as 'available' | 'tentative') ?? 'available']))
	);
	const [brushMode, setBrushMode] = useState<'available' | 'tentative'>('available');
	const [isDragging, setIsDragging] = useState(false);
	const [dragAction, setDragAction] = useState<'paint' | 'remove'>('paint');
	const [touchMode, setTouchMode] = useState<'scroll' | 'select' | 'lock'>('scroll');
	const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
	const [hoveredSlot, setHoveredSlot] = useState<string | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const [containerHeight, setContainerHeight] = useState(400);
	const isMobile = useMediaQuery(768);
	const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const isFirstRender = useRef(true);
	const onSaveRef = useRef(onSave);
	const pendingSelectedRef = useRef<Map<string, 'available' | 'tentative'> | null>(null);
	onSaveRef.current = onSave;

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

	// Debounced auto-save when selected changes (1 second debounce)
	useEffect(() => {
		if (isFirstRender.current) {
			isFirstRender.current = false;
			return;
		}
		setSaveStatus('saving');
		if (saveTimer.current) clearTimeout(saveTimer.current);
		if (clearTimer.current) clearTimeout(clearTimer.current);

		pendingSelectedRef.current = selected;

		saveTimer.current = setTimeout(async () => {
			pendingSelectedRef.current = null;
			try {
				const slots = ALL_SLOTS
					.filter((s) => selected.has(s.start_time))
					.map((s) => ({ ...s, slot_status: selected.get(s.start_time)! }));
				await onSave(slots);
				setSaveStatus('saved');
				clearTimer.current = setTimeout(() => setSaveStatus('idle'), 2000);
			} catch {
				setSaveStatus('error');
				clearTimer.current = setTimeout(() => setSaveStatus('idle'), 3000);
			}
		}, 1000);

		return () => {
			if (saveTimer.current) clearTimeout(saveTimer.current);
		};
	}, [selected]);

	// Flush any pending save immediately when navigating away (component unmounts)
	useEffect(() => {
		return () => {
			if (pendingSelectedRef.current !== null) {
				const sel = pendingSelectedRef.current;
				const slots = ALL_SLOTS
					.filter((s) => sel.has(s.start_time))
					.map((s) => ({ ...s, slot_status: sel.get(s.start_time)! }));
				onSaveRef.current(slots).catch(() => {});
			}
		};
	}, []);

	// Always start from index 0 -- past slots remain visible (dimmed + strikethrough)
	const startIndex = 0;

	const nextDate = useMemo(() => getNextDate(date), [date]);
	const totalSlots = filteredSlots.length;
	const numColumns = isMobile ? 2 : 3;
	const slotsPerColumn = Math.ceil(totalSlots / numColumns);

	// Base local date for detecting +1 day slots
	const baseLocalDate = useMemo(() => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-CA'), [date]);

	// Current UTC timestamp for past-slot detection (full datetime, not just time-of-day)
	const nowMs = useMemo(() => Date.now(), []);

	// Build visible slots, using dateOffset for correct date on midnight-crossing ranges
	const visibleSlots = useMemo(() => {
		const total = filteredSlots.length;
		return Array.from({ length: totalSlots }, (_, i) => {
			const raw = startIndex + i;
			const wrapped = raw % total;
			const slot = filteredSlots[wrapped];
			const slotDate = (slot.dateOffset > 0 || raw >= total) ? nextDate : date;
			return { ...slot, slotDate };
		});
	}, [startIndex, totalSlots, date, nextDate, filteredSlots]);

	const columns = useMemo(
		() => Array.from({ length: numColumns }, (_, i) => visibleSlots.slice(i * slotsPerColumn, (i + 1) * slotsPerColumn)),
		[visibleSlots, numColumns, slotsPerColumn],
	);

	// All voters per slot (including self), with status
	const slotVoters = useMemo(() => {
		const map = new Map<string, Voter[]>();
		for (const slot of allSlots) {
			if (!map.has(slot.start_time)) map.set(slot.start_time, []);
			map.get(slot.start_time)!.push({
				userId: slot.user_id,
				status: slot.status ?? 'manual',
				slotStatus: slot.slot_status ?? 'available',
			});
		}
		return map;
	}, [allSlots]);

	const toggleSlot = useCallback((time: string, forceAction?: 'paint' | 'remove') => {
		setSelected((prev) => {
			const next = new Map(prev);
			const currentStatus = next.get(time);
			const action = forceAction ?? (currentStatus === brushMode ? 'remove' : 'paint');
			if (action === 'remove') {
				next.delete(time);
			} else {
				next.set(time, brushMode);
			}
			return next;
		});
	}, [brushMode]);

	const handleTouchMove = (e: TouchEvent) => {
		if (!isDragging || touchMode !== 'select') return;
		e.preventDefault();
		const touch = e.touches[0];
		const el = document.elementFromPoint(touch.clientX, touch.clientY);
		const time = el?.getAttribute('data-time');
		if (time) toggleSlot(time, dragAction);
	};

	const formatDateLabel = (dateStr: string): string => {
		const d = new Date(dateStr + 'T12:00:00Z');
		return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	};

	const colTimeRange = (col: typeof visibleSlots) => {
		if (col.length === 0) return null;
		const firstSlot = col[0];
		const lastSlot = col[col.length - 1];
		const dateLabel = formatDateLabel(firstSlot.slotDate);
		const first = formatLocalTimeClean(firstSlot.start_time, firstSlot.slotDate);
		const last = formatLocalTimeClean(lastSlot.start_time, lastSlot.slotDate);
		const firstLocalDate = new Date(`${firstSlot.slotDate}T${firstSlot.start_time}:00Z`).toLocaleDateString('en-CA');
		const lastLocalDate = new Date(`${lastSlot.slotDate}T${lastSlot.start_time}:00Z`).toLocaleDateString('en-CA');
		const crossesMidnight = firstLocalDate !== lastLocalDate;
		return (
			<>
				{dateLabel}: {first} {'\u2013'} {last}
				{crossesMidnight && (
					<>
						{' '}
						<span style={{ color: 'var(--warning)', fontSize: '0.75em', verticalAlign: 'super', fontWeight: 600 }}>
							+1
						</span>
					</>
				)}
			</>
		);
	};

	const isSlotPast = (slotTime: string, slotDate: string): boolean => {
		const slotMs = new Date(`${slotDate}T${slotTime}:00Z`).getTime();
		return slotMs < nowMs;
	};

	const statusText = saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? '\u2713 Saved' : saveStatus === 'error' ? 'Save failed' : '';
	const statusColor = saveStatus === 'saved' ? 'var(--success)' : saveStatus === 'error' ? 'var(--danger)' : 'var(--text-muted)';

	const mobileHint = touchMode === 'select'
		? 'Tap to toggle slots'
		: touchMode === 'lock'
			? 'Tap a slot to see who'
			: 'Enable Select or Lock';

	const brushButtons = (
		<div style={{ display: 'flex', gap: '2px' }}>
			<button
				class={`btn ${brushMode === 'available' ? 'btn-primary' : 'btn-secondary'}`}
				style={{ fontSize: '12px', padding: '4px 8px', display: 'flex', alignItems: 'center', gap: '4px' }}
				onClick={() => setBrushMode('available')}
			>
				<span style={{ display: 'inline-block', width: '3px', height: '14px', borderRadius: '2px', background: 'var(--accent)' }} />
				Avail
			</button>
			<button
				class={`btn ${brushMode === 'tentative' ? 'btn-primary' : 'btn-secondary'}`}
				style={{ fontSize: '12px', padding: '4px 8px', display: 'flex', alignItems: 'center', gap: '4px' }}
				onClick={() => setBrushMode('tentative')}
			>
				<span style={{ display: 'inline-block', width: '3px', height: '14px', borderRadius: '2px', background: 'var(--warning)' }} />
				Tentative
			</button>
		</div>
	);

	return (
		<div>
			{/* Action bar */}
			<div style={{
				display: 'flex',
				justifyContent: 'space-between',
				alignItems: 'center',
				marginBottom: '6px',
				...(isMobile ? { position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg-primary)', paddingTop: '4px', paddingBottom: '4px' } : {}),
			}}>
				<div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
					{isMobile && (
						<div style={{ display: 'flex', gap: '4px' }}>
							<button
								class={`btn ${touchMode === 'select' ? 'btn-primary' : 'btn-secondary'}`}
								style={{ fontSize: '12px', padding: '4px 10px' }}
								onClick={() => setTouchMode(prev => prev === 'select' ? 'scroll' : 'select')}
							>
								Select
							</button>
							<button
								class={`btn ${touchMode === 'lock' ? 'btn-primary' : 'btn-secondary'}`}
								style={{ fontSize: '12px', padding: '4px 10px' }}
								onClick={() => setTouchMode(prev => prev === 'lock' ? 'scroll' : 'lock')}
							>
								Lock
							</button>
						</div>
					)}
					{isMobile && <div style={{ width: '1px', height: '20px', background: 'var(--border)' }} />}
					{brushButtons}
					<span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
						{isMobile ? mobileHint : 'Click or drag to select \u00b7 hover for details'}
					</span>
				</div>
				<span style={{ fontSize: '12px', color: statusColor, minWidth: '70px', textAlign: 'right' }}>
					{statusText}
				</span>
			</div>

			{/* Tentative confirm banner */}
			{isTentative && onConfirm && (
				<div style={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					gap: '8px',
					padding: '6px 10px',
					marginBottom: '6px',
					background: 'rgba(234, 179, 8, 0.12)',
					border: '1px solid var(--warning)',
					borderRadius: 'var(--radius)',
					fontSize: '12px',
					color: 'var(--text-secondary)',
				}}>
					<span>Auto-filled from last week - toggle any slot or press Confirm</span>
					<button
						class="btn btn-primary"
						style={{ fontSize: '12px', padding: '4px 12px', flexShrink: 0 }}
						disabled={confirming}
						onClick={async () => {
							setConfirming(true);
							await onConfirm();
							setConfirming(false);
						}}
					>
						{confirming ? '...' : 'Confirm'}
					</button>
				</div>
			)}

			{/* Time columns */}
			<div
				ref={containerRef}
				onMouseUp={() => setIsDragging(false)}
				onMouseLeave={() => { setIsDragging(false); setHoveredSlot(null); }}
				onTouchMove={handleTouchMove}
				onTouchEnd={() => setIsDragging(false)}
				style={{
					display: 'grid',
					gridTemplateColumns: `repeat(${numColumns}, 1fr)`,
					gap: isMobile ? '8px' : '0 12px',
					touchAction: touchMode === 'select' ? 'none' : 'auto',
					...(isMobile ? {} : { height: `${containerHeight}px`, overflowX: 'hidden', overflowY: 'auto' }),
				}}
			>
				{columns.map((col, ci) => (
					<div
						key={ci}
						style={{
							display: 'flex',
							flexDirection: 'column',
							gap: '1px',
							overflow: 'hidden',
							...(!isMobile && ci < numColumns - 1 ? { borderRight: '1px solid var(--border)', paddingRight: '12px' } : {}),
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
							const voters = slotVoters.get(slot.start_time);
							const voterCount = voters?.length ?? 0;
							const isHourStart = slot.start_time.endsWith(':00');
							const isPast = isSlotPast(slot.start_time, slot.slotDate);
							const slotLocalDate = new Date(`${slot.slotDate}T${slot.start_time}:00Z`).toLocaleDateString('en-CA');
							const isNextLocalDay = slotLocalDate !== baseLocalDate;
							const showPopover = hoveredSlot === slot.start_time && voterCount > 0 && !isDragging;

							return (
								<div
									key={slot.start_time}
									data-time={slot.start_time}
									onMouseDown={() => {
										const currentStatus = selected.get(slot.start_time);
										const action = currentStatus === brushMode ? 'remove' : 'paint';
										setIsDragging(true);
										setDragAction(action);
										toggleSlot(slot.start_time, action);
									}}
									onMouseEnter={() => {
										if (isDragging) toggleSlot(slot.start_time, dragAction);
										else if (voterCount > 0) setHoveredSlot(slot.start_time);
									}}
									onMouseLeave={() => {
										if (hoveredSlot === slot.start_time) setHoveredSlot(null);
									}}
									onTouchStart={() => {
										if (touchMode === 'select') {
											const currentStatus = selected.get(slot.start_time);
											const action = currentStatus === brushMode ? 'remove' : 'paint';
											setIsDragging(true);
											setDragAction(action);
											toggleSlot(slot.start_time, action);
										} else if (touchMode === 'lock') {
											setHoveredSlot(prev => prev === slot.start_time ? null : slot.start_time);
										}
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
										position: 'relative',
										background: isHourStart ? 'var(--bg-card)' : 'var(--bg-tertiary)',
										color: 'var(--text-secondary)',
										borderTop: isHourStart ? '1px solid var(--border)' : 'none',
									}}
								>
									{/* Clipping wrapper for decorative bars */}
									<div style={{
										position: 'absolute', inset: 0,
										borderRadius: 'inherit',
										overflow: 'hidden',
										pointerEvents: 'none',
									}}>
										{/* Green fill bar */}
										{(() => {
											if (voterCount === 0 || totalGuildUsers <= 0) return null;
											const fillPct = Math.min((voterCount / totalGuildUsers) * 100, 100);
											return (
												<div style={{
													position: 'absolute', top: 0, right: 0, bottom: 0,
													width: `${fillPct}%`,
													background: 'rgba(34, 197, 94, 0.3)',
													borderRadius: '0 3px 3px 0',
													pointerEvents: 'none', zIndex: 0,
												}} />
											);
										})()}
										{/* Left accent bar */}
										{isSelected && (
											<div style={{
												position: 'absolute', top: 0, left: 0, bottom: 0,
												width: '3px',
												background: selected.get(slot.start_time) === 'tentative' ? 'var(--warning)' : 'var(--accent)',
												borderRadius: '3px 0 0 3px',
												zIndex: 2,
											}} />
										)}
									</div>
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
											position: 'relative',
											zIndex: 1,
										}}
									>
										{formatLocalTimeClean(slot.start_time, slot.slotDate)}
										{isNextLocalDay && (
											<span style={{ color: 'var(--warning)', fontSize: '0.85em', verticalAlign: 'super', fontWeight: 600, marginLeft: '2px' }}>
												+1
											</span>
										)}
									</span>
									{voterCount > 0 && (
										<InlineAvatars voters={voters!} userMap={userMap} />
									)}
									{showPopover && (
										<SlotPopover voters={voters!} userMap={userMap} />
									)}
								</div>
							);
						})}
					</div>
				))}
			</div>
			<div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '6px', fontSize: '11px', color: 'var(--text-muted)', alignItems: 'center' }}>
				<span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
					<span style={{ display: 'inline-block', width: '3px', height: '12px', borderRadius: '2px', background: 'var(--accent)' }} />
					available
				</span>
				<span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
					<span style={{ display: 'inline-block', width: '3px', height: '12px', borderRadius: '2px', background: 'var(--warning)' }} />
					tentative
				</span>
				<span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
					<span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', border: '2px solid var(--success)', boxSizing: 'border-box' }} />
					available
				</span>
				<span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
					<span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', border: '2px solid var(--warning)', boxSizing: 'border-box' }} />
					tentative
				</span>
				<span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
					<span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', border: '2px dashed var(--text-muted)', boxSizing: 'border-box' }} />
					auto-filled
				</span>
				<span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
					<span style={{ display: 'inline-block', width: '14px', height: '10px', borderRadius: '2px', background: 'rgba(34, 197, 94, 0.3)' }} />
					overlap
				</span>
			</div>
		</div>
	);
}
