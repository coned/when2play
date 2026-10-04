import type { ComponentChildren } from 'preact';
import type { User } from '@when2play/shared';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { BottomNav } from './BottomNav';
import { useMediaQuery } from '../../hooks/useMediaQuery';

interface ShellProps {
	user: User;
	activeTab: string;
	onTabChange: (tab: string) => void;
	onLogout: () => void;
	onUserUpdate: () => void;
	children: ComponentChildren;
}

export function Shell({ user, activeTab, onTabChange, onLogout, onUserUpdate, children }: ShellProps) {
	const isMobile = useMediaQuery(768);

	return (
		<div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
			<Header user={user} onLogout={onLogout} onUserUpdate={onUserUpdate} />
			<div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
				{!isMobile && <Sidebar activeTab={activeTab} onTabChange={onTabChange} isAdmin={user.is_admin} />}
				<main
					style={{
						flex: 1,
						overflow: 'auto',
						padding: isMobile ? '16px' : '24px',
						// Clear the fixed bottom nav (56 px plus the home indicator area)
						paddingBottom: isMobile ? 'calc(72px + env(safe-area-inset-bottom, 0px))' : '24px',
					}}
				>
					{children}
				</main>
			</div>
			{isMobile && <BottomNav activeTab={activeTab} onTabChange={onTabChange} isAdmin={user.is_admin} />}
		</div>
	);
}
