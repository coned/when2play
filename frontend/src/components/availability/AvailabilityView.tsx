import { useState, useEffect, useCallback, useMemo } from 'preact/hooks';
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
	const [mySlots, setMySlots] = useState<any[]>([]);
	const [allSlots, setAllSlots] = useState<any[]>([]);
	const [loading, setLoading] = useState(true);
	const [availStartHourET, setAvailStartHourET] = useState<number | undefined>(undefined);
	const [availEndHourET, setAvailEndHourET] = useState<number | undefined>(undefined);
	const [userMap, setUserMap] = useState<Map<string, { display_name: string | null; avatar_url: string | null }>>(new Map());

	// Fetch settings + users + status map on mount
	useEffect(() => {
		(async () => {
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
			}

			// Fetch status map for all 10 dates (non-critical, degrade gracefully)
			try {
				const statusResult = await api.getMyAvailabilityStatus(effectiveDates[0], effectiveDates[effectiveDates.length - 1]);
				if (statusResult.ok) {
					setStatusMap(statusResult.data as AvailabilityStatusMap);
				}
			} catch {
				// Status table may not exist yet
			}
		})();
	}, []);

	// Fetch slots when selectedDate changes
	const fetchSlots = useCallback(async () => {
		setLoading(true);
		const [myResult, allResult] = await Promise.all([
			api.getAvailability({ user_id: userId, date: selectedDate }),
			api.getAvailability({ date: selectedDate }),
		]);

		if (myResult.ok) setMySlots(myResult.data);
		if (allResult.ok) setAllSlots(allResult.data);
		setLoading(false);
	}, [userId, selectedDate]);

	useEffect(() => {
		fetchSlots();
	}, [fetchSlots]);

	// Derive the status for the currently selected date
	const dateStatus = useMemo(() => {
		return (statusMap[selectedDate] as 'tentative' | 'confirmed' | 'manual' | null) ?? null;
	}, [statusMap, selectedDate]);

	// For tentative dates, extract the user's auto-filled slots from allSlots
	const effectiveMySlots = useMemo(() => {
		if (dateStatus === 'tentative' && mySlots.length === 0) {
			return allSlots.filter((s: any) => s.user_id === userId && s.status === 'tentative');
		}
		return mySlots;
	}, [dateStatus, mySlots, allSlots, userId]);

	// Auto-save from TimeGrid: persist to API then refresh overlap data
	const handleSave = async (slots: Array<{ start_time: string; end_time: string }>) => {
		const result = await api.setAvailability({ date: selectedDate, slots });
		if (result.ok) {
			// Update status map: user acted, so this becomes 'manual'
			setStatusMap((prev) => ({ ...prev, [selectedDate]: 'manual' }));
			// Refresh allSlots (other users' overlap) without resetting TimeGrid
			const allResult = await api.getAvailability({ date: selectedDate });
			if (allResult.ok) setAllSlots(allResult.data);
		}
	};

	// Confirm tentative availability
	const handleConfirm = async () => {
		const result = await api.confirmAvailability(selectedDate);
		if (result.ok) {
			setStatusMap((prev) => ({ ...prev, [selectedDate]: 'confirmed' }));
			// Refresh slots to get the persisted data
			const [myResult, allResult] = await Promise.all([
				api.getAvailability({ user_id: userId, date: selectedDate }),
				api.getAvailability({ date: selectedDate }),
			]);
			if (myResult.ok) setMySlots(myResult.data);
			if (allResult.ok) setAllSlots(allResult.data);
		}
	};

	// Count distinct other users who have any availability for this date
	const totalParticipants = useMemo(() => {
		const others = new Set<string>();
		for (const slot of allSlots) {
			if (slot.user_id !== userId) others.add(slot.user_id);
		}
		return others.size;
	}, [allSlots, userId]);

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

			{loading ? (
				<div class="spinner" style={{ margin: '20px auto' }} />
			) : (
				<TimeGrid
					key={selectedDate}
					date={selectedDate}
					mySlots={effectiveMySlots}
					allSlots={allSlots}
					userId={userId}
					onSave={handleSave}
					availStartHourET={availStartHourET}
					availEndHourET={availEndHourET}
					totalParticipants={totalParticipants}
					userMap={userMap}
					dateStatus={dateStatus}
					onConfirm={handleConfirm}
				/>
			)}
		</div>
	);
}
