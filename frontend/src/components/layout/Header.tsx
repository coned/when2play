import type { User } from '@when2play/shared';
import { useTheme, THEMES } from '../../hooks/useTheme';

interface HeaderProps {
	user: User | null;
	onLogout: () => void;
}

export function Header({ user, onLogout }: HeaderProps) {
	const { theme, setTheme } = useTheme();

	return (
		<header
			style={{
				height: 'var(--header-height)',
				background: 'var(--bg-secondary)',
				borderBottom: '1px solid var(--border)',
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'space-between',
				padding: '0 20px',
			}}
		>
			<div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
				<span style={{ fontSize: '20px', fontWeight: 700, color: 'var(--accent)' }}>when2play</span>
			</div>

			<div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
				<div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
					{THEMES.map((t) => (
						<button
							key={t.id}
							title={t.label}
							onClick={() => setTheme(t.id)}
							style={{
								width: '16px',
								height: '16px',
								borderRadius: '50%',
								background: t.accent,
								border: theme === t.id ? '2px solid var(--text-primary)' : '2px solid transparent',
								cursor: 'pointer',
								padding: 0,
								outline: theme === t.id ? '2px solid var(--accent)' : 'none',
								outlineOffset: '1px',
							}}
						/>
					))}
				</div>

				{user && (
					<>
						{user.avatar_url && (
							<img
								src={user.avatar_url}
								alt={user.discord_username}
								style={{ width: '32px', height: '32px', borderRadius: '50%' }}
							/>
						)}
						<span class="header-username" style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
							{user.discord_username}
						</span>
						<button class="btn btn-secondary" style={{ padding: '4px 12px', fontSize: '12px' }} onClick={onLogout}>
							Logout
						</button>
					</>
				)}
			</div>
		</header>
	);
}
