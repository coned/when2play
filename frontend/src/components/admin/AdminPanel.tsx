import { useState, useEffect } from 'preact/hooks';
import { api } from '../../api/client';

interface SettingsState {
	time_granularity_minutes: number;
	game_pool_lifespan_days: number;
	gather_cooldown_seconds: number;
	gather_hourly_limit: number;
	avail_start_hour_et: number;
	avail_end_hour_et: number;
	rally_button_labels: Record<string, string>;
	rally_suggested_phrases: Record<string, string[]>;
	rally_show_discord_command: boolean;
}

const RALLY_ACTION_TYPES = ['call', 'in', 'out', 'brb', 'ping', 'where', 'judge_time', 'judge_avail'] as const;
const DEFAULT_RALLY_LABELS: Record<string, string> = {
	call: 'Call', in: 'In', out: 'Out', brb: 'BRB',
	ping: 'Ping', where: 'Where', judge_time: 'Judge Time', judge_avail: 'Judge Avail',
};

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

function TextField({
	label,
	hint,
	value,
	placeholder,
	onChange,
}: {
	label: string;
	hint?: string;
	value: string;
	placeholder?: string;
	onChange: (v: string) => void;
}) {
	return (
		<div style={{ marginBottom: '16px' }}>
			<label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', color: 'var(--text-primary)' }}>
				{label}
			</label>
			<input
				type="text"
				value={value}
				placeholder={placeholder}
				onInput={(e) => onChange((e.target as HTMLInputElement).value)}
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
		avail_start_hour_et: 17,
		avail_end_hour_et: 3,
		rally_button_labels: {},
		rally_suggested_phrases: {},
		rally_show_discord_command: true,
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
					avail_start_hour_et: (s.avail_start_hour_et as number) ?? 17,
					avail_end_hour_et: (s.avail_end_hour_et as number) ?? 3,
					rally_button_labels: (s.rally_button_labels as Record<string, string>) ?? {},
					rally_suggested_phrases: (s.rally_suggested_phrases as Record<string, string[]>) ?? {},
					rally_show_discord_command: s.rally_show_discord_command !== false,
				});
			}
			setLoading(false);
		});
	}, []);

	const set = (key: keyof SettingsState) => (v: number) =>
		setSettings((s) => ({ ...s, [key]: v }));

	const setRallyLabel = (actionType: string, value: string) => {
		setSettings((s) => ({
			...s,
			rally_button_labels: { ...s.rally_button_labels, [actionType]: value },
		}));
	};

	const setRallyPhrases = (actionType: string, value: string) => {
		const phrases = value.split(',').map((p) => p.trim()).filter(Boolean);
		setSettings((s) => ({
			...s,
			rally_suggested_phrases: { ...s.rally_suggested_phrases, [actionType]: phrases },
		}));
	};

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
				<Field
					label="Display start hour (ET, 0-23)"
					hint="First hour shown in the availability grid. Default: 17 (5 PM ET)."
					value={settings.avail_start_hour_et}
					min={0}
					max={23}
					onChange={set('avail_start_hour_et')}
				/>
				<Field
					label="Display end hour (ET, 0-23)"
					hint="Last hour shown. Wraps past midnight. Default: 3 (3 AM ET next day)."
					value={settings.avail_end_hour_et}
					min={0}
					max={23}
					onChange={set('avail_end_hour_et')}
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

			<SectionCard title="Rally Buttons">
				{RALLY_ACTION_TYPES.map((actionType) => (
					<div key={actionType} style={{ marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px solid var(--border)' }}>
						<TextField
							label={`"${DEFAULT_RALLY_LABELS[actionType]}" button label`}
							placeholder={DEFAULT_RALLY_LABELS[actionType]}
							value={settings.rally_button_labels[actionType] || ''}
							onChange={(v) => setRallyLabel(actionType, v)}
						/>
						<TextField
							label={`Suggested phrases`}
							hint="Comma-separated list of quick-reply phrases."
							placeholder="e.g. On my way, 5 mins, After this game"
							value={(settings.rally_suggested_phrases[actionType] ?? []).join(', ')}
							onChange={(v) => setRallyPhrases(actionType, v)}
						/>
					</div>
				))}
				<div style={{ marginBottom: '16px' }}>
					<label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: 'var(--text-primary)', cursor: 'pointer' }}>
						<input
							type="checkbox"
							checked={settings.rally_show_discord_command}
							onChange={(e) => setSettings((s) => ({ ...s, rally_show_discord_command: (e.target as HTMLInputElement).checked }))}
							style={{ width: 'auto' }}
						/>
						Show Discord command names under buttons
					</label>
					<p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
						Display "/call", "/in", etc. below button labels.
					</p>
				</div>
			</SectionCard>

			{error && (
				<p style={{ color: 'var(--danger)', fontSize: '14px', marginBottom: '12px' }}>{error}</p>
			)}
			{success && (
				<p style={{ color: 'var(--success)', fontSize: '14px', marginBottom: '12px' }}>Settings saved.</p>
			)}

			<button class="btn btn-primary" onClick={handleSave} disabled={saving}>
				{saving ? 'Saving...' : 'Save Settings'}
			</button>
		</div>
	);
}
