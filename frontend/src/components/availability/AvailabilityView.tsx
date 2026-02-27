import { useState, useEffect, useCallback } from 'preact/hooks';
import { api } from '../../api/client';
import { TimeGrid } from './TimeGrid';
import { getTimezoneAbbreviation } from '../../lib/time';

interface AvailabilityViewProps {
	userId: string;
}

function todayStr() {
	return new Date().toISOString().split('T')[0];
}

function tomorrowStr() {
	const d = new Date();
	d.setDate(d.getDate() + 1);
	return d.toISOString().split('T')[0];
}

export function AvailabilityView({ userId }: AvailabilityViewProps) {
	const [selectedDate, setSelectedDate] = useState(todayStr());
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

	const today = todayStr();
	const tomorrow = tomorrowStr();
	const isToday = selectedDate === today;

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
					isToday={isToday}
					availStartHourET={availStartHourET}
					availEndHourET={availEndHourET}
				/>
			)}
		</div>
	);
}
