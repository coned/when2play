interface SidebarProps {
	activeTab: string;
	onTabChange: (tab: string) => void;
	isAdmin: boolean;
}

const BASE_TABS = [
	{ id: 'schedule', label: 'Schedule' },
	{ id: 'games', label: 'Games' },
	{ id: 'availability', label: 'Availability' },
	{ id: 'gather', label: 'Gather' },
	{ id: 'shame', label: 'Shame Wall' },
];

const ADMIN_TAB = { id: 'admin', label: 'Settings' };

export function Sidebar({ activeTab, onTabChange, isAdmin }: SidebarProps) {
	const tabs = isAdmin ? [...BASE_TABS, ADMIN_TAB] : BASE_TABS;

	return (
		<nav
			style={{
				width: 'var(--sidebar-width)',
				background: 'var(--bg-secondary)',
				borderRight: '1px solid var(--border)',
				padding: '16px 0',
				display: 'flex',
				flexDirection: 'column',
				gap: '2px',
			}}
		>
			{tabs.map((tab) => (
				<button
					key={tab.id}
					onClick={() => onTabChange(tab.id)}
					style={{
						display: 'block',
						width: '100%',
						padding: '10px 20px',
						textAlign: 'left',
						background: activeTab === tab.id ? 'var(--bg-tertiary)' : 'transparent',
						color: activeTab === tab.id ? 'var(--accent)' : 'var(--text-secondary)',
						fontSize: '14px',
						fontWeight: activeTab === tab.id ? 600 : 400,
						borderLeft: activeTab === tab.id ? '3px solid var(--accent)' : '3px solid transparent',
						transition: 'all 0.15s',
					}}
				>
					{tab.label}
				</button>
			))}
		</nav>
	);
}
