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
	children: ComponentChildren;
}

export function Shell({ user, activeTab, onTabChange, onLogout, children }: ShellProps) {
	const isMobile = useMediaQuery(768);

	return (
		<div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
			<Header user={user} onLogout={onLogout} />
			<div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
				{!isMobile && <Sidebar activeTab={activeTab} onTabChange={onTabChange} isAdmin={user.is_admin} />}
				<main
					style={{
						flex: 1,
						overflow: 'auto',
						padding: isMobile ? '16px' : '24px',
						paddingBottom: isMobile ? '72px' : '24px',
					}}
				>
					{children}
				</main>
			</div>
			{isMobile && <BottomNav activeTab={activeTab} onTabChange={onTabChange} isAdmin={user.is_admin} />}
		</div>
	);
}
