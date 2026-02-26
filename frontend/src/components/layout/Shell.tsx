import type { ComponentChildren } from 'preact';
import type { User } from '@when2play/shared';
import { Header } from './Header';
import { Sidebar } from './Sidebar';

interface ShellProps {
	user: User;
	activeTab: string;
	onTabChange: (tab: string) => void;
	onLogout: () => void;
	children: ComponentChildren;
}

export function Shell({ user, activeTab, onTabChange, onLogout, children }: ShellProps) {
	return (
		<div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
			<Header user={user} onLogout={onLogout} />
			<div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
				<Sidebar activeTab={activeTab} onTabChange={onTabChange} />
				<main
					style={{
						flex: 1,
						overflow: 'auto',
						padding: '24px',
					}}
				>
					{children}
				</main>
			</div>
		</div>
	);
}
