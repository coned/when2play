import { useState, useMemo, useRef, useEffect, useLayoutEffect, useCallback } from 'preact/hooks';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { formatLocalTimeClean } from '../../lib/time';

import { etHourToUtcSlot } from '@when2play/shared';
import type { AvailabilityStatus } from '@when2play/shared';
import { avatarInitial } from '../../lib/initials';

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

/** Slots to send for a selection, in grid order. */
function selectionToSlots(sel: Map<string, 'available' | 'tentative'>) {
	return ALL_SLOTS
		.filter((s) => sel.has(s.start_time))
		.map((s) => ({ ...s, slot_status: sel.get(s.start_time)! }));
}

function getNextDate(dateStr: string): string {
	const d = new Date(dateStr + 'T12:00:00Z');
	d.setUTCDate(d.getUTCDate() + 1);
	return d.toISOString().split('T')[0];
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

const POPOVER_ID = 'slot-popover';
/** A touch that moves further than this (CSS px) is a swipe, not a tap */
const TAP_SLOP = 10;

/**
 * Who is available in a slot. Rendered once at the grid root with fixed
 * positioning, so no scroll container or `overflow: hidden` column can clip it.
 * Placed above the slot when there is room, otherwise below, and kept inside
 * the viewport.
 */
function SlotPopover({ anchor, voters, userMap, interactive, popoverRef }: {
	anchor: HTMLElement;
	voters: Voter[];
	userMap: Map<string, { display_name: string | null; avatar_url: string | null }>;
	interactive: boolean;
	popoverRef: { current: HTMLDivElement | null };
}) {
	const shown = voters.slice(0, 5);
	const overflow = voters.length - shown.length;
	const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

	useLayoutEffect(() => {
		const el = popoverRef.current;
		if (!el) return;
		const a = anchor.getBoundingClientRect();
		const w = el.offsetWidth;
		const h = el.offsetHeight;
		const vw = document.documentElement.clientWidth;
		const vh = window.innerHeight;
		const margin = 8;
		const gap = 4;
		let left = a.left + a.width / 2 - w / 2;
		left = Math.max(margin, Math.min(left, vw - w - margin));
		let top = a.top - h - gap;
		if (top < margin) top = a.bottom + gap;
		top = Math.max(margin, Math.min(top, vh - h - margin));
		setPos({ left, top });
	}, [anchor, voters]);

	return (
		<div
			ref={popoverRef}
			id={POPOVER_ID}
			role="tooltip"
			style={{
				position: 'fixed',
				left: pos ? `${pos.left}px` : '0px',
				top: pos ? `${pos.top}px` : '0px',
				visibility: pos ? 'visible' : 'hidden',
				background: 'var(--bg-card)',
				border: '1px solid var(--border)',
				borderRadius: '6px',
				padding: '6px 10px',
				zIndex: 1000,
				minWidth: '120px',
				maxWidth: '200px',
				boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
				pointerEvents: interactive ? 'auto' : 'none',
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
										color: 'var(--on-accent)',
										flexShrink: 0,
									}}
								>
									{avatarInitial(name)}
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

function InlineAvatars({ voters, userMap, wide }: { voters: Voter[]; userMap: Map<string, { display_name: string | null; avatar_url: string | null }>; wide: boolean }) {
	const shown = voters.slice(0, MAX_INLINE_AVATARS);
	const overflow = voters.length - shown.length;

	// data-avatars: on touch, a tap here shows who is available instead of toggling the slot.
	// On the phone layout the cluster fills the slot height with extra padding so it is easy to hit.
	return (
		<div
			data-avatars=""
			style={{
				display: 'flex',
				alignItems: 'center',
				flexShrink: 0,
				position: 'relative',
				zIndex: 1,
				...(wide ? { alignSelf: 'stretch', padding: '0 4px 0 12px', marginRight: '-4px' } : {}),
			}}
		>
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
								draggable={false}
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
								{avatarInitial(name)}
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
	// Initialised once per mount. The parent only mounts the grid once the slots and the
	// day's status are known, and remounts it (new key) after a confirm, so this always
	// equals what the next save would write.
	const [selected, setSelected] = useState<Map<string, 'available' | 'tentative'>>(
		() => new Map(mySlots.map((s: any) => [s.start_time, (s.slot_status as 'available' | 'tentative') ?? 'available']))
	);
	const [brushMode, setBrushMode] = useState<'available' | 'tentative'>('available');
	const [isDragging, setIsDragging] = useState(false);
	// Touch only: while on, pressing and dragging paints a range and the grid does not scroll
	const [dragSelect, setDragSelect] = useState(false);
	const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
	// Message of the last failed save; stays visible until a later save succeeds
	const [saveError, setSaveError] = useState<string | null>(null);
	const [confirmError, setConfirmError] = useState<string | null>(null);
	// Slot whose voters are shown: on mouse hover, on a tap of its avatars, or on keyboard focus
	const [popover, setPopover] = useState<{ time: string; source: 'hover' | 'touch' | 'focus' } | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const popoverRef = useRef<HTMLDivElement | null>(null);
	// Active drag (mouse, or touch with Drag to select on)
	const dragRef = useRef<{ pointerId: number; action: 'paint' | 'remove'; last: string } | null>(null);
	// Touch that may still become a tap (cleared when it moves or the browser starts scrolling)
	const tapRef = useRef<{ pointerId: number; x: number; y: number; time: string; avatars: boolean } | null>(null);
	// Touch that only dismissed the open popover; it must not toggle anything
	const dismissPointerRef = useRef<number | null>(null);
	const [containerHeight, setContainerHeight] = useState(400);
	const isMobile = useMediaQuery(768);
	const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const isFirstRender = useRef(true);
	const mountedRef = useRef(true);
	const onSaveRef = useRef(onSave);
	// Selection changed but the debounce has not fired yet
	const pendingSelectedRef = useRef<Map<string, 'available' | 'tentative'> | null>(null);
	// Selection waiting to be saved once the in-flight save finishes (latest wins)
	const queuedSelectedRef = useRef<Map<string, 'available' | 'tentative'> | null>(null);
	const saveInFlightRef = useRef(false);
	const selectedRef = useRef(selected);
	onSaveRef.current = onSave;
	selectedRef.current = selected;

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

	/**
	 * Save queued selections one at a time. Never runs two saves at once: a selection
	 * queued while a save is in flight is saved (once, latest wins) after it finishes.
	 * Only the outcome of the last save is shown. Keeps running after unmount so a
	 * flushed save still completes.
	 */
	const drainSaves = async () => {
		if (saveInFlightRef.current) return;
		saveInFlightRef.current = true;
		let error: string | null = null;
		while (queuedSelectedRef.current) {
			const sel = queuedSelectedRef.current;
			queuedSelectedRef.current = null;
			try {
				await onSaveRef.current(selectionToSlots(sel));
				error = null;
			} catch (e) {
				error = e instanceof Error && e.message ? e.message : 'Save failed';
			}
		}
		saveInFlightRef.current = false;

		// A newer change is still debouncing; its save will report the outcome
		if (!mountedRef.current || pendingSelectedRef.current) return;
		if (clearTimer.current) clearTimeout(clearTimer.current);
		if (error) {
			setSaveStatus('error');
			setSaveError(error);
		} else {
			setSaveStatus('saved');
			setSaveError(null);
			clearTimer.current = setTimeout(() => setSaveStatus('idle'), 2000);
		}
	};

	const saveNow = (sel: Map<string, 'available' | 'tentative'>) => {
		if (saveTimer.current) clearTimeout(saveTimer.current);
		saveTimer.current = null;
		pendingSelectedRef.current = null;
		queuedSelectedRef.current = sel;
		drainSaves();
	};

	const retrySave = () => {
		setSaveStatus('saving');
		saveNow(selectedRef.current);
	};

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
		saveTimer.current = setTimeout(() => saveNow(selected), 1000);
	}, [selected]);

	// Flush any pending save immediately when navigating away (component unmounts)
	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			if (clearTimer.current) clearTimeout(clearTimer.current);
			if (pendingSelectedRef.current !== null) {
				saveNow(pendingSelectedRef.current);
			} else if (saveTimer.current) {
				clearTimeout(saveTimer.current);
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

	/** Paint or erase these slots. Leaves the state untouched when nothing changes. */
	const applyAction = useCallback((times: string[], action: 'paint' | 'remove') => {
		setSelected((prev) => {
			let changed = false;
			const next = new Map(prev);
			for (const time of times) {
				if (action === 'remove') {
					if (next.delete(time)) changed = true;
				} else if (next.get(time) !== brushMode) {
					next.set(time, brushMode);
					changed = true;
				}
			}
			return changed ? next : prev;
		});
	}, [brushMode]);

	const toggleSlot = (time: string) => {
		applyAction([time], selectedRef.current.get(time) === brushMode ? 'remove' : 'paint');
	};

	// Column and row of each visible slot, to fill the gap when a drag skips slots
	const slotPos = useMemo(() => {
		const map = new Map<string, { col: number; row: number }>();
		columns.forEach((col, ci) => col.forEach((slot, ri) => map.set(slot.start_time, { col: ci, row: ri })));
		return map;
	}, [columns]);

	// While dragging, follow the pointer anywhere on the page until it is released.
	// A skipped slot (fast move) is filled in when the last and the new slot share a column.
	// Read through a ref so the listeners added at drag start always see current values.
	const dragMoveRef = useRef<(e: PointerEvent) => void>(() => {});
	dragMoveRef.current = (e: PointerEvent) => {
		const drag = dragRef.current;
		if (!drag || e.pointerId !== drag.pointerId) return;
		if (e.pointerType !== 'mouse') e.preventDefault();
		const el = document.elementFromPoint(e.clientX, e.clientY);
		if (!el || !containerRef.current?.contains(el)) return;
		const time = (el.closest('[data-time]') as HTMLElement | null)?.dataset.time;
		if (!time || time === drag.last) return;
		const a = slotPos.get(drag.last);
		const b = slotPos.get(time);
		let times = [time];
		if (a && b && a.col === b.col) {
			const [lo, hi] = a.row < b.row ? [a.row, b.row] : [b.row, a.row];
			times = columns[a.col].slice(lo, hi + 1).map((s) => s.start_time);
		}
		drag.last = time;
		applyAction(times, drag.action);
	};
	const endDragRef = useRef<(() => void) | null>(null);

	const beginDrag = (pointerId: number, time: string) => {
		endDragRef.current?.();
		const action = selectedRef.current.get(time) === brushMode ? 'remove' : 'paint';
		dragRef.current = { pointerId, action, last: time };
		setIsDragging(true);
		setPopover(null);
		applyAction([time], action);

		// Added right here, not in an effect: a quick click can release before effects run
		const onMove = (e: PointerEvent) => dragMoveRef.current(e);
		const onEnd = (e: PointerEvent) => { if (e.pointerId === pointerId) end(); };
		const end = () => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onEnd);
			window.removeEventListener('pointercancel', onEnd);
			if (endDragRef.current === end) endDragRef.current = null;
			dragRef.current = null;
			if (mountedRef.current) setIsDragging(false);
		};
		window.addEventListener('pointermove', onMove, { passive: false });
		window.addEventListener('pointerup', onEnd);
		window.addEventListener('pointercancel', onEnd);
		endDragRef.current = end;
	};

	useEffect(() => () => endDragRef.current?.(), []);

	/**
	 * One input path for mouse, touch and pen (no separate mouse and touch handlers, so the
	 * browser's compatibility mouse events after a tap cannot toggle a slot a second time).
	 * Mouse: press toggles and dragging paints or erases. Touch: a tap toggles once, a swipe
	 * scrolls the page (the browser cancels the pointer), a tap on the avatars shows who is
	 * available, and with Drag to select on a drag paints or erases.
	 */
	const handlePointerDown = (e: PointerEvent) => {
		const target = e.target as Element;
		tapRef.current = null;
		if (dismissPointerRef.current === e.pointerId) {
			dismissPointerRef.current = null;
			return;
		}
		const slotEl = target.closest('[data-time]') as HTMLElement | null;
		if (!slotEl) return;
		const time = slotEl.dataset.time!;
		if (e.pointerType === 'mouse') {
			if (e.button !== 0) return;
			e.preventDefault();
			beginDrag(e.pointerId, time);
			return;
		}
		const onAvatars = target.closest('[data-avatars]') !== null;
		if (dragSelect && !onAvatars) {
			e.preventDefault();
			beginDrag(e.pointerId, time);
			return;
		}
		tapRef.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, time, avatars: onAvatars };
	};

	const handlePointerMove = (e: PointerEvent) => {
		const tap = tapRef.current;
		if (tap && tap.pointerId === e.pointerId && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > TAP_SLOP) {
			tapRef.current = null;
		}
	};

	const handlePointerUp = (e: PointerEvent) => {
		const tap = tapRef.current;
		tapRef.current = null;
		if (!tap || tap.pointerId !== e.pointerId) return;
		if (Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > TAP_SLOP) return;
		if (tap.avatars && slotVoters.has(tap.time)) {
			setPopover((prev) => (prev?.time === tap.time && prev.source === 'touch' ? null : { time: tap.time, source: 'touch' }));
			return;
		}
		toggleSlot(tap.time);
	};

	// A popover opened by touch closes on a tap anywhere else; a tap on the grid that only
	// closed it toggles nothing (a tap on another slot's avatars opens that one instead).
	// Any popover closes on Escape, scroll or resize.
	useEffect(() => {
		if (!popover) return;
		const close = () => setPopover(null);
		const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
		const onDown = (e: PointerEvent) => {
			if (popover.source !== 'touch') return;
			const target = e.target as Element;
			if (popoverRef.current?.contains(target)) return;
			const avatars = target.closest('[data-avatars]');
			const slotEl = target.closest('[data-time]') as HTMLElement | null;
			if (avatars && slotEl?.dataset.time === popover.time) return;
			close();
			if (!avatars && containerRef.current?.contains(target)) dismissPointerRef.current = e.pointerId;
		};
		window.addEventListener('keydown', onKey);
		window.addEventListener('pointerdown', onDown, true);
		window.addEventListener('scroll', close, true);
		window.addEventListener('resize', close);
		return () => {
			window.removeEventListener('keydown', onKey);
			window.removeEventListener('pointerdown', onDown, true);
			window.removeEventListener('scroll', close, true);
			window.removeEventListener('resize', close);
		};
	}, [popover]);

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
	// While a save is pending or in flight, Confirm is disabled (it would race the save)
	const isSaving = saveStatus === 'saving';
	const statusColor = saveStatus === 'saved' ? 'var(--success)' : saveStatus === 'error' ? 'var(--danger)' : 'var(--text-muted)';

	const popoverVoters = popover && !isDragging ? slotVoters.get(popover.time) : undefined;
	const popoverAnchor = popoverVoters
		? (containerRef.current?.querySelector(`[data-time="${popover!.time}"]`) as HTMLElement | null) ?? null
		: null;

	const mobileHint = dragSelect
		? 'Drag to select is on: drag across slots to paint them. The grid does not scroll.'
		: 'Tap a slot to toggle it. Tap the faces to see who is free.';

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
				gap: '6px',
				...(isMobile ? { position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg-primary)', paddingTop: '4px', paddingBottom: '4px', flexWrap: 'wrap' } : {}),
			}}>
				<div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
					{isMobile && (
						<button
							class={`btn ${dragSelect ? 'btn-primary' : 'btn-secondary'}`}
							style={{ fontSize: '12px', padding: '4px 10px' }}
							aria-pressed={dragSelect}
							onClick={() => setDragSelect((prev) => !prev)}
						>
							Drag to select
						</button>
					)}
					{isMobile && <div style={{ width: '1px', height: '20px', background: 'var(--border)' }} />}
					{brushButtons}
					{!isMobile && (
						<span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
							Click or drag to select {'\u00b7'} hover for details
						</span>
					)}
				</div>
				<span role="status" style={{ fontSize: '12px', color: statusColor, minWidth: '70px', textAlign: 'right' }}>
					{statusText}
				</span>
				{isMobile && (
					<p data-testid="grid-hint" style={{ flexBasis: '100%', fontSize: '12px', color: dragSelect ? 'var(--text-primary)' : 'var(--text-muted)' }}>
						{mobileHint}
					</p>
				)}
			</div>

			{/* Save failure: stays until a later save succeeds */}
			{saveError !== null && (
				<div role="alert" style={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					gap: '8px',
					padding: '6px 10px',
					marginBottom: '6px',
					border: '1px solid var(--danger)',
					borderRadius: 'var(--radius)',
					fontSize: '12px',
					color: 'var(--danger)',
				}}>
					<span>Your availability was not saved: {saveError}</span>
					<button
						class="btn btn-secondary"
						style={{ fontSize: '12px', padding: '4px 12px', flexShrink: 0 }}
						disabled={isSaving}
						onClick={retrySave}
					>
						{isSaving ? 'Saving...' : 'Retry'}
					</button>
				</div>
			)}

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
					<span>
						Auto-filled from last week - toggle any slot or press Confirm
						{confirmError !== null && (
							<span role="alert" style={{ display: 'block', color: 'var(--danger)' }}>
								Confirm failed: {confirmError}
							</span>
						)}
					</span>
					<button
						class="btn btn-primary"
						style={{ fontSize: '12px', padding: '4px 12px', flexShrink: 0 }}
						disabled={confirming || isSaving}
						onClick={async () => {
							setConfirming(true);
							setConfirmError(null);
							try {
								await onConfirm();
							} catch (e) {
								if (mountedRef.current) setConfirmError(e instanceof Error && e.message ? e.message : 'Confirm failed');
							} finally {
								if (mountedRef.current) setConfirming(false);
							}
						}}
					>
						{confirming ? '...' : 'Confirm'}
					</button>
				</div>
			)}

			{/* Time columns */}
			<div
				ref={containerRef}
				onPointerDown={handlePointerDown}
				onPointerMove={handlePointerMove}
				onPointerUp={handlePointerUp}
				onPointerCancel={() => { tapRef.current = null; }}
				onPointerLeave={(e) => {
					if (e.pointerType === 'mouse') setPopover((prev) => (prev?.source === 'hover' ? null : prev));
				}}
				style={{
					display: 'grid',
					gridTemplateColumns: `repeat(${numColumns}, 1fr)`,
					gap: isMobile ? '8px' : '0 12px',
					// Default: a vertical swipe scrolls the page and the browser cancels the tap.
					// Drag to select: the grid keeps every touch, so a drag paints instead of scrolling.
					touchAction: dragSelect ? 'none' : 'pan-y pinch-zoom',
					WebkitTouchCallout: 'none',
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
							const popoverOpen = popover?.time === slot.start_time && voterCount > 0 && !isDragging;

							return (
								<div
									key={slot.start_time}
									data-time={slot.start_time}
									role="button"
									tabIndex={0}
									aria-pressed={isSelected}
									aria-describedby={popoverOpen ? POPOVER_ID : undefined}
									onPointerEnter={(e) => {
										if (e.pointerType !== 'mouse' || dragRef.current) return;
										setPopover((prev) => (voterCount > 0
											? { time: slot.start_time, source: 'hover' }
											: prev?.source === 'hover' ? null : prev));
									}}
									onKeyDown={(e) => {
										if (e.key === 'Enter' || e.key === ' ') {
											e.preventDefault();
											toggleSlot(slot.start_time);
										}
									}}
									onFocus={(e) => {
										const el = e.currentTarget as HTMLElement;
										if (voterCount > 0 && el.matches(':focus-visible')) setPopover({ time: slot.start_time, source: 'focus' });
									}}
									onBlur={() => setPopover((prev) => (prev?.source === 'focus' ? null : prev))}
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
										<InlineAvatars voters={voters!} userMap={userMap} wide={isMobile} />
									)}
								</div>
							);
						})}
					</div>
				))}
			</div>
			{popoverAnchor && popoverVoters && (
				<SlotPopover
					anchor={popoverAnchor}
					voters={popoverVoters}
					userMap={userMap}
					interactive={popover?.source === 'touch'}
					popoverRef={popoverRef}
				/>
			)}
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
