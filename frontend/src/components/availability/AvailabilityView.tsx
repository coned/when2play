import { useState, useEffect, useCallback, useMemo, useRef } from 'preact/hooks';
import { api } from '../../api/client';
import { TimeGrid } from './TimeGrid';
import { DateStrip } from './DateStrip';
import { getTimezoneAbbreviation, availabilityDateRange } from '../../lib/time';
import type { AvailabilityStatusMap } from '@when2play/shared';

interface AvailabilityViewProps {
	userId: string;
}

export function AvailabilityView({ userId }: AvailabilityViewProps) {
	const [cutoffHourET, setCutoffHourET] = useState(5);
	const [dates, setDates] = useState<string[]>(() => availabilityDateRange(5, 10));
	const [selectedDate, setSelectedDate] = useState(() => dates[0]);
	const [statusMap, setStatusMap] = useState<AvailabilityStatusMap>({});
	// True once the status request has finished (a failed request counts as known, with no status).
	// The grid must not become interactive before this, or auto-filled slots would be missing
	// from its selection and the next save would drop them.
	const [statusLoaded, setStatusLoaded] = useState(false);
	const [mySlots, setMySlots] = useState<any[]>([]);
	const [allSlots, setAllSlots] = useState<any[]>([]);
	// Date the loaded mySlots/allSlots belong to (guards against stale responses)
	const [slotsDate, setSlotsDate] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [slotsError, setSlotsError] = useState<string | null>(null);
	// Bumped to remount the grid with fresh server data (after a confirm)
	const [gridEpoch, setGridEpoch] = useState(0);
	const [availStartHourET, setAvailStartHourET] = useState<number | undefined>(undefined);
	const [availEndHourET, setAvailEndHourET] = useState<number | undefined>(undefined);
	const [userMap, setUserMap] = useState<Map<string, { display_name: string | null; avatar_url: string | null }>>(new Map());
	const [totalGuildUsers, setTotalGuildUsers] = useState(0);

	// Fetch settings + users + status map on mount
	useEffect(() => {
		(async () => {
			try {
				await loadSettingsAndStatus();
			} finally {
				// Also after a failed request: render the grid without settings/status rather than spin forever
				setStatusLoaded(true);
			}
		})();

		async function loadSettingsAndStatus() {
			const [settingsResult, usersResult] = await Promise.all([
				api.getSettings(),
				api.getUsers(),
			]);

			let effectiveDates = dates;
			if (settingsResult.ok) {
				const s = settingsResult.data as Record<string, unknown>;
				if (s.avail_start_hour_et !== undefined) setAvailStartHourET(s.avail_start_hour_et as number);
				if (s.avail_end_hour_et !== undefined) setAvailEndHourET(s.avail_end_hour_et as number);
				if (s.day_cutoff_hour_et !== undefined) {
					const cutoff = s.day_cutoff_hour_et as number;
					setCutoffHourET(cutoff);
					effectiveDates = availabilityDateRange(cutoff, 10);
					setDates(effectiveDates);
					setSelectedDate(effectiveDates[0]);
				}
			}
			if (usersResult.ok) {
				const map = new Map<string, { display_name: string | null; avatar_url: string | null }>();
				for (const u of usersResult.data) map.set(u.id, { display_name: u.display_name ?? u.discord_username, avatar_url: u.avatar_url });
				setUserMap(map);
				setTotalGuildUsers(usersResult.data.length);
			}

			// Fetch status map for all 10 dates (non-critical: without it the grid shows no status)
			const statusResult = await api.getMyAvailabilityStatus(effectiveDates[0], effectiveDates[effectiveDates.length - 1]);
			if (statusResult.ok) {
				setStatusMap(statusResult.data as AvailabilityStatusMap);
			}
		}
	}, []);

	// Track the selected date for async callbacks that finish after the user moved on
	const selectedDateRef = useRef(selectedDate);
	selectedDateRef.current = selectedDate;

	// All availability writes (saves and confirms, from any grid instance) run one at a time,
	// in order. Reads of the user's own slots wait for queued writes, so a remounted grid
	// never starts from data that a pending save is about to replace.
	const writeChainRef = useRef<Promise<unknown>>(Promise.resolve());
	const enqueueWrite = <T,>(fn: () => Promise<T>): Promise<T> => {
		const p = writeChainRef.current.then(fn);
		writeChainRef.current = p.catch(() => {});
		return p;
	};

	// Fetch slots when selectedDate changes
	const fetchSeq = useRef(0);
	const fetchSlots = useCallback(async () => {
		const seq = ++fetchSeq.current;
		const date = selectedDate;
		setLoading(true);
		await writeChainRef.current;
		const [myResult, allResult] = await Promise.all([
			api.getAvailability({ user_id: userId, date }),
			api.getAvailability({ date }),
		]);
		// A newer request (another date) superseded this one
		if (seq !== fetchSeq.current) return;

		// Both are needed to build the selection (auto-filled slots come from allSlots).
		// Without them an interactive grid would start empty and its next save would wipe the day.
		if (!myResult.ok || !allResult.ok) {
			setSlotsError((!myResult.ok && myResult.error.message) || (!allResult.ok && allResult.error.message) || 'Could not reach the server');
			setLoading(false);
			return;
		}
		setSlotsError(null);
		setMySlots(myResult.data);
		setAllSlots(allResult.data);
		setSlotsDate(date);
		setLoading(false);
	}, [userId, selectedDate]);

	useEffect(() => {
		fetchSlots();
	}, [fetchSlots]);

	// Derive the status for the currently selected date
	const dateStatus = useMemo(() => {
		const info = statusMap[selectedDate];
		if (!info) return null;
		return (info.status as 'tentative' | 'confirmed' | 'manual' | null) ?? null;
	}, [statusMap, selectedDate]);

	// For tentative dates, extract the user's auto-filled slots from allSlots
	const effectiveMySlots = useMemo(() => {
		if (dateStatus === 'tentative' && mySlots.length === 0) {
			return allSlots.filter((s: any) => s.user_id === userId && s.status === 'tentative');
		}
		return mySlots;
	}, [dateStatus, mySlots, allSlots, userId]);

	// Refresh the overlap data for a date, if it is still the one on screen (non-critical)
	const refreshAllSlots = async (date: string) => {
		// On failure the overlap view stays as it was
		const allResult = await api.getAvailability({ date });
		if (allResult.ok && selectedDateRef.current === date) setAllSlots(allResult.data);
	};

	// Auto-save from TimeGrid: persist to API then refresh overlap data.
	// Throws on any failure so TimeGrid can show it; never reports a failed save as saved.
	const handleSave = (date: string) => (slots: Array<{ start_time: string; end_time: string; slot_status?: string }>) =>
		enqueueWrite(async () => {
			// A network failure comes back as a NETWORK_ERROR result with a readable message
			const result = await api.setAvailability({ date, slots });
			if (!result.ok) throw new Error(result.error?.message || 'Save failed');
			// Update status map: user acted, so this becomes 'manual'
			const hasTentativeSlots = slots.some((s) => s.slot_status === 'tentative');
			setStatusMap((prev) => ({ ...prev, [date]: { status: 'manual', hasTentativeSlots: hasTentativeSlots || undefined } }));
			// Refresh allSlots (other users' overlap) without resetting TimeGrid
			await refreshAllSlots(date);
		});

	// Confirm tentative availability. Throws on failure so TimeGrid can show it.
	const handleConfirm = async () => {
		const date = selectedDate;
		const result = await enqueueWrite(() => api.confirmAvailability(date));
		if (!result.ok) throw new Error(result.error?.message || 'Confirm failed');

		setStatusMap((prev) => ({ ...prev, [date]: { status: 'confirmed' } }));
		if (selectedDateRef.current !== date) return;
		// The response holds the persisted slots for this date; remount the grid so its
		// selection shows exactly what was confirmed.
		setMySlots(result.data);
		setGridEpoch((e) => e + 1);
		await refreshAllSlots(date);
	};

	const gridReady = statusLoaded && !loading && slotsDate === selectedDate;

	return (
		<div>
			<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
				<h2>Availability</h2>
			</div>

			<DateStrip
				dates={dates}
				selectedDate={selectedDate}
				statusMap={statusMap}
				onSelect={setSelectedDate}
			/>

			<p style={{ marginTop: '6px', marginBottom: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
				Times in {getTimezoneAbbreviation()}
			</p>

			{!loading && slotsError !== null ? (
				<div role="alert" style={{ margin: '20px 0', fontSize: '13px', color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: '8px' }}>
					<span>Could not load availability: {slotsError}</span>
					<button class="btn btn-secondary" style={{ fontSize: '12px', padding: '4px 12px' }} onClick={() => fetchSlots()}>
						Retry
					</button>
				</div>
			) : !gridReady ? (
				<div class="spinner" style={{ margin: '20px auto' }} />
			) : (
				<TimeGrid
					key={`${selectedDate}#${gridEpoch}`}
					date={selectedDate}
					mySlots={effectiveMySlots}
					allSlots={allSlots}
					userId={userId}
					onSave={handleSave(selectedDate)}
					availStartHourET={availStartHourET}
					availEndHourET={availEndHourET}
					totalGuildUsers={totalGuildUsers}
					userMap={userMap}
					dateStatus={dateStatus}
					onConfirm={handleConfirm}
				/>
			)}
		</div>
	);
}
