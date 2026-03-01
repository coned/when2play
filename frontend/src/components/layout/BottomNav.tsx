interface BottomNavProps {
	activeTab: string;
	onTabChange: (tab: string) => void;
	isAdmin: boolean;
}

const BASE_TABS = [
	{ id: 'dashboard', label: 'Dashboard', icon: '\u{1F4C5}' },
	{ id: 'games', label: 'Games', icon: '\u{1F3AE}' },
	{ id: 'availability', label: 'Available', icon: '\u{1F552}' },
	{ id: 'rally', label: 'Rally', icon: '\u{1F4E2}' },
	{ id: 'tree', label: 'Tree', icon: '\u{1F333}' },
	{ id: 'shame', label: 'Shame', icon: '\u{1F525}' },
	{ id: 'blog', label: 'Blog', icon: '\u{1F4DD}' },
];

const ADMIN_TAB = { id: 'admin', label: 'Settings', icon: '\u2699\uFE0F' };

export function BottomNav({ activeTab, onTabChange, isAdmin }: BottomNavProps) {
	const tabs = isAdmin ? [...BASE_TABS, ADMIN_TAB] : BASE_TABS;

	return (
		<nav
			style={{
				position: 'fixed',
				bottom: 0,
				left: 0,
				right: 0,
				height: '56px',
				background: 'var(--bg-secondary)',
				borderTop: '1px solid var(--border)',
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'space-around',
				paddingBottom: 'env(safe-area-inset-bottom)',
				zIndex: 100,
			}}
		>
			{tabs.map((tab) => (
				<button
					key={tab.id}
					onClick={() => onTabChange(tab.id)}
					style={{
						flex: 1,
						display: 'flex',
						flexDirection: 'column',
						alignItems: 'center',
						gap: '2px',
						padding: '6px 0',
						background: 'transparent',
						color: activeTab === tab.id ? 'var(--accent)' : 'var(--text-muted)',
						fontSize: '10px',
						fontWeight: activeTab === tab.id ? 600 : 400,
						minHeight: '44px',
						justifyContent: 'center',
					}}
				>
					<span style={{ fontSize: '18px' }}>{tab.icon}</span>
					{tab.label}
				</button>
			))}
		</nav>
	);
}
