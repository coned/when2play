import { useState } from 'preact/hooks';
import type { User } from '@when2play/shared';
import { useTheme, THEMES } from '../../hooks/useTheme';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { api } from '../../api/client';

interface HeaderProps {
	user: User | null;
	onLogout: () => void;
}

export function Header({ user, onLogout }: HeaderProps) {
	const { theme, setTheme } = useTheme();
	const isMobile = useMediaQuery(768);
	const [showProfile, setShowProfile] = useState(false);
	const [displayName, setDisplayName] = useState(user?.display_name ?? user?.discord_username ?? '');
	const [syncFromDiscord, setSyncFromDiscord] = useState(user?.sync_name_from_discord ?? true);
	const [saving, setSaving] = useState(false);

	const displayLabel = user?.display_name ?? user?.discord_username ?? '';

	const handleSaveProfile = async () => {
		if (!user) return;
		setSaving(true);
		await api.updateMe({
			display_name: displayName,
			sync_name_from_discord: syncFromDiscord,
		});
		setSaving(false);
		setShowProfile(false);
	};

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
				position: 'relative',
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
								alt={displayLabel}
								style={{ width: '32px', height: '32px', borderRadius: '50%', cursor: 'pointer' }}
								onClick={() => setShowProfile(!showProfile)}
							/>
						)}
						{!isMobile && (
							<span
								style={{ color: 'var(--text-secondary)', fontSize: '14px', cursor: 'pointer' }}
								onClick={() => setShowProfile(!showProfile)}
							>
								{displayLabel}
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

			{/* Profile dropdown */}
			{showProfile && user && (
				<div
					style={{
						position: 'absolute',
						top: 'var(--header-height)',
						right: isMobile ? '12px' : '20px',
						background: 'var(--bg-card)',
						border: '1px solid var(--border)',
						borderRadius: 'var(--radius-lg)',
						padding: '16px',
						boxShadow: 'var(--shadow)',
						zIndex: 100,
						minWidth: '260px',
					}}
				>
					<h4 style={{ margin: '0 0 12px', fontSize: '14px', color: 'var(--text-primary)' }}>Profile</h4>
					<div style={{ marginBottom: '12px' }}>
						<label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
							Display Name
						</label>
						<input
							type="text"
							value={displayName}
							maxLength={50}
							onInput={(e) => setDisplayName((e.target as HTMLInputElement).value)}
							style={{ width: '100%', fontSize: '13px', padding: '6px 10px' }}
						/>
					</div>
					<label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-primary)', cursor: 'pointer', marginBottom: '12px' }}>
						<input
							type="checkbox"
							checked={syncFromDiscord}
							onChange={(e) => setSyncFromDiscord((e.target as HTMLInputElement).checked)}
							style={{ width: 'auto' }}
						/>
						Sync name from Discord
					</label>
					<div style={{ display: 'flex', gap: '8px' }}>
						<button class="btn btn-primary" style={{ fontSize: '12px', padding: '4px 12px' }} onClick={handleSaveProfile} disabled={saving}>
							{saving ? 'Saving...' : 'Save'}
						</button>
						<button class="btn btn-secondary" style={{ fontSize: '12px', padding: '4px 12px' }} onClick={() => setShowProfile(false)}>
							Cancel
						</button>
					</div>
				</div>
			)}
		</header>
	);
}
