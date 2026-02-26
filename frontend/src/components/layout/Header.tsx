import type { User } from '@when2play/shared';
import { useTheme, THEMES } from '../../hooks/useTheme';
import { useMediaQuery } from '../../hooks/useMediaQuery';

interface HeaderProps {
	user: User | null;
	onLogout: () => void;
}

export function Header({ user, onLogout }: HeaderProps) {
	const { theme, setTheme } = useTheme();
	const isMobile = useMediaQuery(768);

	return (
		<header
			style={{
				height: 'var(--header-height)',
				background: 'var(--bg-secondary)',
				borderBottom: '1px solid var(--border)',
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'space-between',
				padding: isMobile ? '0 12px' : '0 20px',
			}}
		>
			<div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
				<span style={{ fontSize: '20px', fontWeight: 700, color: 'var(--accent)' }}>when2play</span>
			</div>

			<div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '8px' : '12px' }}>
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
						{!isMobile && (
							<span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
								{user.discord_username}
							</span>
						)}
						{user.is_admin && (
							<span
								style={{
									padding: '2px 8px',
									borderRadius: '9999px',
									fontSize: '11px',
									fontWeight: 600,
									background: 'var(--accent-dim)',
									color: '#dbeafe',
								}}
							>
								Admin
							</span>
						)}
						<button class="btn btn-secondary" style={{ padding: '4px 12px', fontSize: '12px' }} onClick={onLogout}>
							Logout
						</button>
					</>
				)}
			</div>
		</header>
	);
}
