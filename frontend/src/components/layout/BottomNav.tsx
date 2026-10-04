interface BottomNavProps {
	activeTab: string;
	onTabChange: (tab: string) => void;
	isAdmin: boolean;
}

// Labels are kept short so all eight tabs stay readable on a 360 px wide phone
const BASE_TABS = [
	{ id: 'dashboard', label: 'Home', icon: '\u{1F4C5}' },
	{ id: 'games', label: 'Games', icon: '\u{1F3AE}' },
	{ id: 'availability', label: 'Avail', icon: '\u{1F552}' },
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
			aria-label="Main"
			style={{
				position: 'fixed',
				bottom: 0,
				left: 0,
				right: 0,
				// 56 px of content plus the home indicator area; padding sits inside the height
				height: 'calc(56px + env(safe-area-inset-bottom, 0px))',
				background: 'var(--bg-secondary)',
				borderTop: '1px solid var(--border)',
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'space-around',
				paddingBottom: 'env(safe-area-inset-bottom, 0px)',
				paddingLeft: 'env(safe-area-inset-left, 0px)',
				paddingRight: 'env(safe-area-inset-right, 0px)',
				zIndex: 100,
			}}
		>
			{tabs.map((tab) => (
				<button
					key={tab.id}
					onClick={() => onTabChange(tab.id)}
					aria-current={activeTab === tab.id ? 'page' : undefined}
					style={{
						flex: '1 1 0',
						minWidth: 0,
						alignSelf: 'stretch',
						display: 'flex',
						flexDirection: 'column',
						alignItems: 'center',
						gap: '2px',
						padding: '4px 0',
						background: 'transparent',
						color: activeTab === tab.id ? 'var(--accent-text)' : 'var(--text-muted)',
						fontSize: '11px',
						lineHeight: 1.2,
						whiteSpace: 'nowrap',
						fontWeight: activeTab === tab.id ? 600 : 400,
						minHeight: '44px',
						justifyContent: 'center',
					}}
				>
					<span aria-hidden="true" style={{ fontSize: '18px', lineHeight: 1.2 }}>{tab.icon}</span>
					{tab.label}
				</button>
			))}
		</nav>
	);
}
