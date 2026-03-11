import { useState } from 'preact/hooks';
import type { User } from '@when2play/shared';
import { Shell } from '../components/layout/Shell';
import { GamePool } from '../components/games/GamePool';
import { AvailabilityView } from '../components/availability/AvailabilityView';
import { GatherBell } from '../components/gather/GatherBell';
import { ShameWall } from '../components/shame/ShameWall';
import { ScheduleSummary } from '../components/schedule/ScheduleSummary';
import { AdminPanel } from '../components/admin/AdminPanel';
import { RallyPanel } from '../components/rally/RallyPanel';
import { GamingTree } from '../components/tree/GamingTree';
import { BlogPage } from '../components/blog/BlogPage';

interface HomeProps {
	user: User;
	onLogout: () => void;
	onUserUpdate: () => void;
}

export function Home({ user, onLogout, onUserUpdate }: HomeProps) {
	const [activeTab, setActiveTab] = useState('dashboard');

	return (
		<Shell user={user} activeTab={activeTab} onTabChange={setActiveTab} onLogout={onLogout} onUserUpdate={onUserUpdate}>
			{activeTab === 'dashboard' && <ScheduleSummary userId={user.id} />}
			{activeTab === 'games' && <GamePool user={user} />}
			{activeTab === 'availability' && <AvailabilityView userId={user.id} />}
			{/* DEPRECATED: gather merged into rally, tab hidden since v0.3 */}
			{activeTab === 'gather' && <GatherBell />}
			{activeTab === 'rally' && <RallyPanel userId={user.id} />}
			{activeTab === 'tree' && <GamingTree />}
			{activeTab === 'shame' && <ShameWall userId={user.id} />}
			{activeTab === 'blog' && <BlogPage />}
			{activeTab === 'admin' && user.is_admin && <AdminPanel />}
		</Shell>
	);
}
