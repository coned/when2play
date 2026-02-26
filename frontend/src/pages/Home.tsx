import { useState } from 'preact/hooks';
import type { User } from '@when2play/shared';
import { Shell } from '../components/layout/Shell';
import { GamePool } from '../components/games/GamePool';
import { AvailabilityView } from '../components/availability/AvailabilityView';
import { GatherBell } from '../components/gather/GatherBell';
import { ShameWall } from '../components/shame/ShameWall';
import { ScheduleSummary } from '../components/schedule/ScheduleSummary';
import { AdminPanel } from '../components/admin/AdminPanel';

interface HomeProps {
	user: User;
	onLogout: () => void;
}

export function Home({ user, onLogout }: HomeProps) {
	const [activeTab, setActiveTab] = useState('schedule');

	return (
		<Shell user={user} activeTab={activeTab} onTabChange={setActiveTab} onLogout={onLogout}>
			{activeTab === 'schedule' && <ScheduleSummary userId={user.id} />}
			{activeTab === 'games' && <GamePool userId={user.id} />}
			{activeTab === 'availability' && <AvailabilityView userId={user.id} />}
			{activeTab === 'gather' && <GatherBell />}
			{activeTab === 'shame' && <ShameWall userId={user.id} />}
			{activeTab === 'admin' && user.is_admin && <AdminPanel />}
		</Shell>
	);
}
