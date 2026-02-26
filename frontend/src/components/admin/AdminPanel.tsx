import { useState, useEffect } from 'preact/hooks';
import { api } from '../../api/client';

interface SettingsState {
	time_granularity_minutes: number;
	game_pool_lifespan_days: number;
	gather_cooldown_seconds: number;
	gather_hourly_limit: number;
}

function Field({
	label,
	hint,
	value,
	min,
	max,
	step,
	onChange,
}: {
	label: string;
	hint?: string;
	value: number;
	min?: number;
	max?: number;
	step?: number;
	onChange: (v: number) => void;
}) {
	return (
		<div style={{ marginBottom: '16px' }}>
			<label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', color: 'var(--text-primary)' }}>
				{label}
			</label>
			<input
				type="number"
				min={min}
				max={max}
				step={step ?? 1}
				value={value}
				onInput={(e) => {
					const v = parseInt((e.target as HTMLInputElement).value, 10);
					if (!isNaN(v)) onChange(v);
				}}
				style={{ width: '100%' }}
			/>
			{hint && (
				<p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>{hint}</p>
			)}
		</div>
	);
}

function SectionCard({ title, children }: { title: string; children: preact.ComponentChildren }) {
	return (
		<div
			class="card"
			style={{ marginBottom: '16px' }}
		>
			<h3
				style={{
					margin: '0 0 16px',
					fontSize: '12px',
					fontWeight: 600,
					color: 'var(--text-secondary)',
					textTransform: 'uppercase',
					letterSpacing: '0.06em',
				}}
			>
				{title}
			</h3>
			{children}
		</div>
	);
}

export function AdminPanel() {
	const [settings, setSettings] = useState<SettingsState>({
		time_granularity_minutes: 15,
		game_pool_lifespan_days: 7,
		gather_cooldown_seconds: 10,
		gather_hourly_limit: 30,
	});
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState('');
	const [success, setSuccess] = useState(false);

	useEffect(() => {
		api.getSettings().then((r) => {
			if (r.ok) {
				const s = r.data as Record<string, unknown>;
				setSettings({
					time_granularity_minutes: (s.time_granularity_minutes as number) ?? 15,
					game_pool_lifespan_days: (s.game_pool_lifespan_days as number) ?? 7,
					gather_cooldown_seconds: (s.gather_cooldown_seconds as number) ?? 10,
					gather_hourly_limit: (s.gather_hourly_limit as number) ?? 30,
				});
			}
			setLoading(false);
		});
	}, []);

	const set = (key: keyof SettingsState) => (v: number) =>
		setSettings((s) => ({ ...s, [key]: v }));

	const handleSave = async () => {
		setSaving(true);
		setError('');
		setSuccess(false);
		const result = await api.updateSettings(settings);
		if (result.ok) {
			setSuccess(true);
			setTimeout(() => setSuccess(false), 3000);
		} else {
			setError((result as any).error.message);
		}
		setSaving(false);
	};

	if (loading) return <div class="spinner" style={{ margin: '40px auto' }} />;

	return (
		<div style={{ maxWidth: '480px' }}>
			<h2 style={{ margin: '0 0 24px', fontSize: '20px', fontWeight: 700 }}>Admin Settings</h2>

			<SectionCard title="Availability">
				<Field
					label="Time slot granularity (minutes)"
					hint="Controls the resolution of availability time slots. Applies globally."
					value={settings.time_granularity_minutes}
					min={5}
					max={60}
					step={5}
					onChange={set('time_granularity_minutes')}
				/>
			</SectionCard>

			<SectionCard title="Game Pool">
				<Field
					label="Game pool lifespan (days)"
					hint="Games older than this are automatically archived."
					value={settings.game_pool_lifespan_days}
					min={1}
					onChange={set('game_pool_lifespan_days')}
				/>
			</SectionCard>

			<SectionCard title="Gather Bell">
				<Field
					label="Per-ping cooldown (seconds)"
					hint="Minimum time between a user's gather pings. Set to 0 to disable."
					value={settings.gather_cooldown_seconds}
					min={0}
					onChange={set('gather_cooldown_seconds')}
				/>
				<Field
					label="Hourly limit (pings per 60 min)"
					hint="Max pings a user can send in any rolling 60-minute window. Lockout expires when the oldest ping ages out. Set to 0 to disable."
					value={settings.gather_hourly_limit}
					min={0}
					onChange={set('gather_hourly_limit')}
				/>
			</SectionCard>

			{error && (
				<p style={{ color: 'var(--danger)', fontSize: '14px', marginBottom: '12px' }}>{error}</p>
			)}
			{success && (
				<p style={{ color: 'var(--success)', fontSize: '14px', marginBottom: '12px' }}>Settings saved.</p>
			)}

			<button class="btn btn-primary" onClick={handleSave} disabled={saving}>
				{saving ? 'Saving…' : 'Save Settings'}
			</button>
		</div>
	);
}
