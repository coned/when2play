import { useState, useRef, useEffect } from 'preact/hooks';
import type { User } from '@when2play/shared';
import { useTheme, THEMES } from '../../hooks/useTheme';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { api } from '../../api/client';
import { avatarInitial } from '../../lib/initials';

interface HeaderProps {
	user: User | null;
	onLogout: () => void;
	onUserUpdate?: () => void;
}

const MENU_ID = 'profile-menu';

/** The user's avatar, or a circle with the first letter of the name when there is none */
function Avatar({ url, name, size }: { url: string | null | undefined; name: string; size: number }) {
	if (url) {
		return <img src={url} alt="" style={{ width: `${size}px`, height: `${size}px`, borderRadius: '50%', display: 'block' }} />;
	}
	return (
		<span
			aria-hidden="true"
			style={{
				width: `${size}px`,
				height: `${size}px`,
				borderRadius: '50%',
				background: 'var(--accent)',
				color: 'var(--on-accent)',
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				fontSize: `${Math.round(size * 0.45)}px`,
				fontWeight: 700,
				lineHeight: 1,
			}}
		>
			{avatarInitial(name)}
		</span>
	);
}

/** Light/dark toggle and the theme dots. `large` gives every control a 44 px touch target. */
function AppearanceControls({ large }: { large: boolean }) {
	const { theme, setTheme, mode, setMode } = useTheme();
	const target = large ? 44 : 22;
	const dot = large ? 26 : 16;

	return (
		<div style={{ display: 'flex', alignItems: 'center', gap: large ? '2px' : '6px', flexWrap: 'wrap' }}>
			<button
				type="button"
				aria-label="Light mode"
				aria-pressed={mode === 'light'}
				title={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
				onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')}
				style={{
					width: `${target}px`,
					height: `${target}px`,
					borderRadius: '50%',
					background: large ? 'transparent' : 'var(--bg-tertiary)',
					border: large ? 'none' : '1px solid var(--border)',
					cursor: 'pointer',
					padding: 0,
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					fontSize: large ? '20px' : '13px',
					lineHeight: 1,
					color: 'var(--text-primary)',
				}}
			>
				<span aria-hidden="true">{mode === 'dark' ? '☾' : '☀'}</span>
			</button>

			<div aria-hidden="true" style={{ width: '1px', height: '16px', background: 'var(--border)', margin: '0 2px' }} />

			{THEMES.map((t) => (
				<button
					key={t.id}
					type="button"
					aria-label={`${t.label} theme`}
					aria-pressed={theme === t.id}
					title={t.label}
					onClick={() => setTheme(t.id)}
					style={{
						width: `${large ? target : dot}px`,
						height: `${large ? target : dot}px`,
						borderRadius: '50%',
						background: 'transparent',
						border: 'none',
						cursor: 'pointer',
						padding: 0,
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
					}}
				>
					<span
						aria-hidden="true"
						style={{
							width: `${dot}px`,
							height: `${dot}px`,
							borderRadius: '50%',
							background: t.accent,
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							fontSize: large ? '14px' : '10px',
							fontWeight: 700,
							color: t.onAccent,
							lineHeight: 1,
						}}
					>
						{theme === t.id ? '✓' : ''}
					</span>
				</button>
			))}
		</div>
	);
}

export function Header({ user, onLogout, onUserUpdate }: HeaderProps) {
	const isMobile = useMediaQuery(768);
	const [showProfile, setShowProfile] = useState(false);
	const [displayName, setDisplayName] = useState(user?.display_name ?? user?.discord_username ?? '');
	const [syncFromDiscord, setSyncFromDiscord] = useState(user?.sync_name_from_discord ?? true);
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);

	const displayLabel = user?.display_name ?? user?.discord_username ?? '';
	const nameEmpty = displayName.trim() === '';

	const openMenu = () => {
		// Start from what is saved, not from an earlier unsaved edit
		setDisplayName(user?.display_name ?? user?.discord_username ?? '');
		setSyncFromDiscord(user?.sync_name_from_discord ?? true);
		setSaveError(null);
		setShowProfile(true);
	};

	const closeMenu = () => {
		setShowProfile(false);
		triggerRef.current?.focus({ preventScroll: true });
	};

	// Move focus into the menu when it opens
	useEffect(() => {
		if (showProfile) menuRef.current?.focus({ preventScroll: true });
	}, [showProfile]);

	// Close on Escape and on a click outside the menu and its trigger
	useEffect(() => {
		if (!showProfile) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.preventDefault();
				closeMenu();
			}
		};
		const onDown = (e: PointerEvent) => {
			const target = e.target as Node;
			if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
			setShowProfile(false);
			// Back to the trigger, unless the click put focus on something else
			setTimeout(() => {
				const active = document.activeElement;
				if (!active || active === document.body || menuRef.current?.contains(active)) {
					triggerRef.current?.focus({ preventScroll: true });
				}
			}, 0);
		};
		document.addEventListener('keydown', onKey);
		document.addEventListener('pointerdown', onDown, true);
		return () => {
			document.removeEventListener('keydown', onKey);
			document.removeEventListener('pointerdown', onDown, true);
		};
	}, [showProfile]);

	const handleSaveProfile = async () => {
		if (!user) return;
		const name = displayName.trim();
		if (!syncFromDiscord && name === '') {
			setSaveError('Display name cannot be empty.');
			return;
		}
		setSaving(true);
		setSaveError(null);
		const result = await api.updateMe({
			...(name !== '' ? { display_name: name } : {}),
			sync_name_from_discord: syncFromDiscord,
		});
		setSaving(false);
		if (!result.ok) {
			setSaveError(result.error?.message || 'Could not save your profile.');
			return;
		}
		closeMenu();
		if (onUserUpdate) onUserUpdate();
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
				gap: '8px',
				padding: isMobile ? '0 12px' : '0 20px',
				position: 'relative',
			}}
		>
			<div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
				<span style={{ fontSize: '20px', fontWeight: 700, color: 'var(--accent-text)' }}>when2play</span>
			</div>

			<div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '6px' : '12px', flexShrink: 0 }}>
				{/* On phones these live in the profile menu */}
				{!isMobile && <AppearanceControls large={false} />}

				{user && (
					<>
						<button
							ref={triggerRef}
							type="button"
							aria-haspopup="dialog"
							aria-expanded={showProfile}
							aria-controls={showProfile ? MENU_ID : undefined}
							aria-label={`${displayLabel || 'Profile'}: profile and settings`}
							onClick={() => (showProfile ? closeMenu() : openMenu())}
							style={{
								display: 'flex',
								alignItems: 'center',
								gap: '8px',
								background: 'transparent',
								border: 'none',
								borderRadius: '9999px',
								padding: isMobile ? '0' : '2px 8px 2px 2px',
								minWidth: isMobile ? '44px' : undefined,
								minHeight: isMobile ? '44px' : '36px',
								justifyContent: 'center',
								color: 'var(--text-secondary)',
								fontSize: '14px',
							}}
						>
							<Avatar url={user.avatar_url} name={displayLabel} size={32} />
							{!isMobile && <span>{displayLabel}</span>}
						</button>
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

			{/* Profile menu */}
			{showProfile && user && (
				<div
					ref={menuRef}
					id={MENU_ID}
					role="dialog"
					aria-label="Profile and settings"
					tabIndex={-1}
					style={{
						position: 'absolute',
						top: 'var(--header-height)',
						right: isMobile ? '12px' : '20px',
						background: 'var(--bg-card)',
						border: '1px solid var(--border)',
						borderRadius: 'var(--radius-lg)',
						padding: '16px',
						boxShadow: 'var(--shadow)',
						zIndex: 200,
						minWidth: '260px',
						maxWidth: 'calc(100vw - 24px)',
					}}
				>
					<h4 style={{ margin: '0 0 12px', fontSize: '14px', color: 'var(--text-primary)' }}>Profile</h4>
					<div style={{ marginBottom: '12px' }}>
						<label for="profile-display-name" style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
							Display Name
						</label>
						<input
							id="profile-display-name"
							type="text"
							value={displayName}
							maxLength={50}
							disabled={syncFromDiscord}
							aria-describedby={syncFromDiscord ? 'profile-sync-note' : nameEmpty ? 'profile-name-error' : undefined}
							aria-invalid={!syncFromDiscord && nameEmpty}
							onInput={(e) => {
								setDisplayName((e.target as HTMLInputElement).value);
								setSaveError(null);
							}}
							style={{ width: '100%', fontSize: '13px', padding: '6px 10px', opacity: syncFromDiscord ? 0.6 : 1 }}
						/>
						{syncFromDiscord && (
							<p id="profile-sync-note" style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
								Synced from Discord: your Discord name replaces this on every login.
							</p>
						)}
						{!syncFromDiscord && nameEmpty && (
							<p id="profile-name-error" style={{ fontSize: '12px', color: 'var(--danger)', marginTop: '4px' }}>
								Display name cannot be empty.
							</p>
						)}
					</div>
					<label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-primary)', cursor: 'pointer', marginBottom: '12px' }}>
						<input
							type="checkbox"
							checked={syncFromDiscord}
							onChange={(e) => {
								setSyncFromDiscord((e.target as HTMLInputElement).checked);
								setSaveError(null);
							}}
							style={{ width: 'auto' }}
						/>
						Sync name from Discord
					</label>
					{saveError !== null && (
						<p role="alert" style={{ fontSize: '12px', color: 'var(--danger)', marginBottom: '12px' }}>
							{saveError}
						</p>
					)}
					<div style={{ display: 'flex', gap: '8px' }}>
						<button
							class="btn btn-primary"
							style={{ fontSize: '12px', padding: '4px 12px' }}
							onClick={handleSaveProfile}
							disabled={saving || (!syncFromDiscord && nameEmpty)}
						>
							{saving ? 'Saving...' : 'Save'}
						</button>
						<button class="btn btn-secondary" style={{ fontSize: '12px', padding: '4px 12px' }} onClick={closeMenu}>
							Cancel
						</button>
					</div>

					{isMobile && (
						<div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border)' }}>
							<h4 style={{ margin: '0 0 4px', fontSize: '14px', color: 'var(--text-primary)' }}>Appearance</h4>
							<AppearanceControls large />
						</div>
					)}
				</div>
			)}
		</header>
	);
}
