import { useState, useEffect, useCallback } from 'preact/hooks';
import { api } from '../../api/client';
import { TimeGrid } from './TimeGrid';
import { getTimezoneAbbreviation, availabilityToday, availabilityTomorrow } from '../../lib/time';

interface AvailabilityViewProps {
	userId: string;
}

export function AvailabilityView({ userId }: AvailabilityViewProps) {
	const [cutoffHourET, setCutoffHourET] = useState(5);
	const [selectedDate, setSelectedDate] = useState(availabilityToday(5));
	const [mySlots, setMySlots] = useState<any[]>([]);
	const [allSlots, setAllSlots] = useState<any[]>([]);
	const [loading, setLoading] = useState(true);
	const [availStartHourET, setAvailStartHourET] = useState<number | undefined>(undefined);
	const [availEndHourET, setAvailEndHourET] = useState<number | undefined>(undefined);

	const fetchSlots = useCallback(async () => {
		setLoading(true);
		const [myResult, allResult, settingsResult] = await Promise.all([
			api.getAvailability({ user_id: userId, date: selectedDate }),
			api.getAvailability({ date: selectedDate }),
			api.getSettings(),
		]);

		if (myResult.ok) setMySlots(myResult.data);
		if (allResult.ok) setAllSlots(allResult.data);
		if (settingsResult.ok) {
			const s = settingsResult.data as Record<string, unknown>;
			if (s.avail_start_hour_et !== undefined) setAvailStartHourET(s.avail_start_hour_et as number);
			if (s.avail_end_hour_et !== undefined) setAvailEndHourET(s.avail_end_hour_et as number);
			if (s.day_cutoff_hour_et !== undefined) setCutoffHourET(s.day_cutoff_hour_et as number);
		}
		setLoading(false);
	}, [userId, selectedDate]);

	useEffect(() => {
		fetchSlots();
	}, [fetchSlots]);

	// Auto-save from TimeGrid: persist to API then refresh overlap data
	const handleSave = async (slots: Array<{ start_time: string; end_time: string }>) => {
		const result = await api.setAvailability({ date: selectedDate, slots });
		if (result.ok) {
			// Refresh allSlots (other users' overlap) without resetting TimeGrid
			const allResult = await api.getAvailability({ date: selectedDate });
			if (allResult.ok) setAllSlots(allResult.data);
		}
	};

	const today = availabilityToday(cutoffHourET);
	const tomorrow = availabilityTomorrow(cutoffHourET);

	return (
		<div>
			<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
				<h2>Availability</h2>
				<div style={{ display: 'flex', gap: '8px' }}>
					<button
						class={`btn ${selectedDate === today ? 'btn-primary' : 'btn-secondary'}`}
						onClick={() => setSelectedDate(today)}
					>
						Today
					</button>
					<button
						class={`btn ${selectedDate === tomorrow ? 'btn-primary' : 'btn-secondary'}`}
						onClick={() => setSelectedDate(tomorrow)}
					>
						Tomorrow
					</button>
				</div>
			</div>

			<p style={{ marginBottom: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
				Times in {getTimezoneAbbreviation()}
			</p>

			{loading ? (
				<div class="spinner" style={{ margin: '20px auto' }} />
			) : (
				<TimeGrid
					key={selectedDate}
					date={selectedDate}
					mySlots={mySlots}
					allSlots={allSlots}
					userId={userId}
					onSave={handleSave}
					availStartHourET={availStartHourET}
					availEndHourET={availEndHourET}
				/>
			)}
		</div>
	);
}
