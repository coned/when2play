import { useEffect, useState } from 'preact/hooks';
import type { User } from '@when2play/shared';
import { Shell } from '../components/layout/Shell';
import { GamePool } from '../components/games/GamePool';
import { AvailabilityView } from '../components/availability/AvailabilityView';
import { ShameWall } from '../components/shame/ShameWall';
import { ScheduleSummary } from '../components/schedule/ScheduleSummary';
import { AdminPanel } from '../components/admin/AdminPanel';
import { RallyPanel } from '../components/rally/RallyPanel';
import { GamingTree } from '../components/tree/GamingTree';
import { BlogPage } from '../components/blog/BlogPage';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import { DEFAULT_TAB, parseTabHash, tabHash, type TabId } from '../lib/routes';

interface HomeProps {
	user: User;
	onLogout: () => void;
	onUserUpdate: () => void;
}

export function Home({ user, onLogout, onUserUpdate }: HomeProps) {
	const isAdmin = user.is_admin;
	const [activeTab, setActiveTab] = useState<TabId>(() => parseTabHash(window.location.hash, isAdmin) ?? DEFAULT_TAB);

	// The hash is the source of truth: follow it on load, on back/forward and on links
	// like <a href="#/availability">. No hash means the dashboard and stays as it is;
	// a hash that names no tab (or admin for a non-admin) is replaced by #/dashboard
	// without a new history entry.
	useEffect(() => {
		const sync = () => {
			const hash = window.location.hash;
			const tab = parseTabHash(hash, isAdmin) ?? DEFAULT_TAB;
			setActiveTab(tab);
			if (hash && hash !== tabHash(tab)) {
				history.replaceState(history.state, '', window.location.pathname + window.location.search + tabHash(tab));
			}
		};
		sync();
		window.addEventListener('hashchange', sync);
		return () => window.removeEventListener('hashchange', sync);
	}, [isAdmin]);

	const changeTab = (tab: string) => {
		const next = parseTabHash(tabHash(tab as TabId), isAdmin);
		if (!next) return;
		setActiveTab(next);
		// Adds a history entry (hashchange then confirms the same tab)
		if (window.location.hash !== tabHash(next)) window.location.hash = tabHash(next);
	};

	return (
		<Shell user={user} activeTab={activeTab} onTabChange={changeTab} onLogout={onLogout} onUserUpdate={onUserUpdate}>
			{/* Keyed by tab: switching tabs mounts a fresh boundary, which clears a render error */}
			<ErrorBoundary key={activeTab} scope="tab">
				{activeTab === 'dashboard' && <ScheduleSummary userId={user.id} />}
				{activeTab === 'games' && <GamePool user={user} />}
				{activeTab === 'availability' && <AvailabilityView userId={user.id} />}
				{activeTab === 'rally' && <RallyPanel userId={user.id} />}
				{activeTab === 'tree' && <GamingTree />}
				{activeTab === 'shame' && <ShameWall userId={user.id} />}
				{activeTab === 'blog' && <BlogPage />}
				{activeTab === 'admin' && user.is_admin && <AdminPanel />}
			</ErrorBoundary>
		</Shell>
	);
}
