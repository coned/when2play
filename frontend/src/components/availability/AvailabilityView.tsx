import { useState, useEffect, useCallback } from 'preact/hooks';
import { api } from '../../api/client';
import { TimeGrid } from './TimeGrid';
import { getUserTimezone } from '../../lib/time';

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

	const handleSave = async (slots: Array<{ start_time: string; end_time: string }>) => {
		await api.setAvailability({ date: selectedDate, slots });
		fetchSlots();
	};

	const today = todayStr();
	const tomorrow = tomorrowStr();

	return (
		<div>
			<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
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

			<p style={{ marginBottom: '20px', fontSize: '13px', color: 'var(--text-muted)' }}>
				Times in UTC (your timezone: {getUserTimezone()})
			</p>

			{loading ? (
				<div class="spinner" style={{ margin: '20px auto' }} />
			) : (
				<TimeGrid
					date={selectedDate}
					mySlots={mySlots}
					allSlots={allSlots}
					userId={userId}
					onSave={handleSave}
				/>
			)}
		</div>
	);
}
