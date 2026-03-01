import { useState, useEffect } from 'preact/hooks';
import { api } from '../../api/client';

interface SettingsState {
	time_granularity_minutes: number;
	game_pool_lifespan_days: number;
	gather_cooldown_seconds: number;
	gather_hourly_limit: number;
	avail_start_hour_et: number;
	avail_end_hour_et: number;
	day_cutoff_hour_et: number;
	rally_button_labels: Record<string, string>;
	rally_suggested_phrases: Record<string, string[]>;
	rally_show_discord_command: boolean;
}

const RALLY_ACTION_TYPES = ['call', 'in', 'out', 'brb', 'ping', 'where', 'judge_avail', 'judge_time', 'share_ranking'] as const;
const DEFAULT_RALLY_LABELS: Record<string, string> = {
	call: 'Call', in: 'In', out: 'Out', brb: 'BRB',
	ping: 'Ping', where: 'Where', judge_avail: 'Judge Avail', judge_time: 'Judge Time', share_ranking: 'Share Ranking',
};

const SETTINGS_WHITELIST: Record<string, 'number' | 'boolean' | 'string' | 'object'> = {
	time_granularity_minutes: 'number',
	game_pool_lifespan_days: 'number',
	gather_cooldown_seconds: 'number',
	gather_hourly_limit: 'number',
	avail_start_hour_et: 'number',
	avail_end_hour_et: 'number',
	day_cutoff_hour_et: 'number',
	day_reset_hour_et: 'number',
	rally_button_labels: 'object',
	rally_suggested_phrases: 'object',
	rally_show_discord_command: 'boolean',
};
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_IMPORT_SIZE = 100 * 1024; // 100KB

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

function PhrasesEditor({
	phrases,
	onChange,
}: {
	phrases: string[];
	onChange: (phrases: string[]) => void;
}) {
	const [newPhrase, setNewPhrase] = useState('');
	const [dragIdx, setDragIdx] = useState<number | null>(null);
	const [dropIdx, setDropIdx] = useState<number | null>(null);

	const addPhrase = () => {
		const trimmed = newPhrase.trim();
		if (!trimmed || phrases.includes(trimmed)) return;
		onChange([...phrases, trimmed]);
		setNewPhrase('');
	};

	const removePhrase = (index: number) => {
		onChange(phrases.filter((_, i) => i !== index));
	};

	const handleDragStart = (e: DragEvent, index: number) => {
		setDragIdx(index);
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', String(index));
		}
	};

	const handleDragOver = (e: DragEvent, index: number) => {
		e.preventDefault();
		setDropIdx(index);
	};

	const handleDrop = (e: DragEvent, index: number) => {
		e.preventDefault();
		if (dragIdx === null || dragIdx === index) {
			setDragIdx(null);
			setDropIdx(null);
			return;
		}
		const reordered = [...phrases];
		const [moved] = reordered.splice(dragIdx, 1);
		reordered.splice(index, 0, moved);
		onChange(reordered);
		setDragIdx(null);
		setDropIdx(null);
	};

	const handleDragEnd = () => {
		setDragIdx(null);
		setDropIdx(null);
	};

	return (
		<div style={{ marginBottom: '16px' }}>
			<label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', color: 'var(--text-primary)' }}>
				Suggested phrases
			</label>
			{phrases.length > 0 && (
				<div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '8px' }}>
					{phrases.map((phrase, i) => (
						<div
							key={`${i}-${phrase}`}
							draggable
							onDragStart={(e) => handleDragStart(e as DragEvent, i)}
							onDragOver={(e) => handleDragOver(e as DragEvent, i)}
							onDrop={(e) => handleDrop(e as DragEvent, i)}
							onDragEnd={handleDragEnd}
							style={{
								display: 'flex',
								alignItems: 'center',
								gap: '6px',
								padding: '4px 8px',
								background: dropIdx === i ? 'var(--accent-hover)' : 'var(--bg-tertiary)',
								borderRadius: '4px',
								fontSize: '13px',
								cursor: 'grab',
								opacity: dragIdx === i ? 0.5 : 1,
								border: dropIdx === i ? '1px dashed var(--accent)' : '1px solid transparent',
							}}
						>
							<span style={{ color: 'var(--text-muted)', fontSize: '11px', cursor: 'grab', flexShrink: 0 }}>
								&#x2630;
							</span>
							<span style={{ flex: 1 }}>{phrase}</span>
							<button
								onClick={() => removePhrase(i)}
								style={{
									background: 'none',
									border: 'none',
									color: 'var(--text-muted)',
									cursor: 'pointer',
									fontSize: '14px',
									padding: '0 2px',
									lineHeight: 1,
									flexShrink: 0,
								}}
								title="Remove phrase"
							>
								&times;
							</button>
						</div>
					))}
				</div>
			)}
			<div style={{ display: 'flex', gap: '6px' }}>
				<input
					type="text"
					value={newPhrase}
					placeholder="Type a phrase..."
					onInput={(e) => setNewPhrase((e.target as HTMLInputElement).value)}
					onKeyDown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							addPhrase();
						}
					}}
					style={{ flex: 1, fontSize: '13px', padding: '4px 8px' }}
					maxLength={100}
				/>
				<button
					class="btn btn-secondary"
					style={{ padding: '4px 10px', fontSize: '12px', flexShrink: 0 }}
					onClick={addPhrase}
					disabled={!newPhrase.trim()}
				>
					Add
				</button>
			</div>
			<p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
				Drag to reorder. Press Enter or click Add.
			</p>
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
		day_cutoff_hour_et: 5,
		rally_button_labels: {},
		rally_suggested_phrases: {},
		rally_show_discord_command: true,
	});
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState('');
	const [success, setSuccess] = useState(false);
	const [importStatus, setImportStatus] = useState('');

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
					day_cutoff_hour_et: (s.day_cutoff_hour_et as number) ?? 5,
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

	const setRallyPhrases = (actionType: string, phrases: string[]) => {
		setSettings((s) => ({
			...s,
			rally_suggested_phrases: { ...s.rally_suggested_phrases, [actionType]: phrases },
		}));
	};

	const handleExport = async () => {
		const result = await api.getSettings();
		if (!result.ok) {
			setImportStatus('Export failed: could not fetch settings.');
			return;
		}
		const raw = result.data as Record<string, unknown>;
		const filtered: Record<string, unknown> = {};
		for (const key of Object.keys(raw)) {
			if (key in SETTINGS_WHITELIST) filtered[key] = raw[key];
		}
		const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'when2play-settings.json';
		a.click();
		URL.revokeObjectURL(url);
	};

	const handleImport = () => {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = '.json,application/json';
		input.onchange = async () => {
			const file = input.files?.[0];
			if (!file) return;
			setImportStatus('');

			if (file.size > MAX_IMPORT_SIZE) {
				setImportStatus('File too large (max 100 KB).');
				return;
			}

			let parsed: unknown;
			try {
				parsed = JSON.parse(await file.text());
			} catch {
				setImportStatus('Invalid JSON file.');
				return;
			}

			if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
				setImportStatus('Expected a JSON object.');
				return;
			}

			const obj = parsed as Record<string, unknown>;
			const validated: Record<string, unknown> = {};
			const skipped: string[] = [];

			for (const [key, value] of Object.entries(obj)) {
				if (DANGEROUS_KEYS.has(key)) { skipped.push(key); continue; }
				const expected = SETTINGS_WHITELIST[key];
				if (!expected) { skipped.push(key); continue; }

				if (expected === 'object') {
					if (typeof value !== 'object' || value === null || Array.isArray(value)) { skipped.push(key); continue; }
				} else if (expected === 'string') {
					if (typeof value !== 'string' || value.length > 1000) { skipped.push(key); continue; }
				} else if (typeof value !== expected) {
					skipped.push(key); continue;
				}
				validated[key] = value;
			}

			if (Object.keys(validated).length === 0) {
				setImportStatus('No valid settings found in file.');
				return;
			}

			const result = await api.updateSettings(validated);
			if (!result.ok) {
				setImportStatus('Import failed: ' + ((result as any).error?.message ?? 'unknown error'));
				return;
			}

			// Refresh local state from server
			const refreshed = await api.getSettings();
			if (refreshed.ok) {
				const s = refreshed.data as Record<string, unknown>;
				setSettings({
					time_granularity_minutes: (s.time_granularity_minutes as number) ?? 15,
					game_pool_lifespan_days: (s.game_pool_lifespan_days as number) ?? 7,
					gather_cooldown_seconds: (s.gather_cooldown_seconds as number) ?? 10,
					gather_hourly_limit: (s.gather_hourly_limit as number) ?? 30,
					avail_start_hour_et: (s.avail_start_hour_et as number) ?? 17,
					avail_end_hour_et: (s.avail_end_hour_et as number) ?? 3,
					day_cutoff_hour_et: (s.day_cutoff_hour_et as number) ?? 5,
					rally_button_labels: (s.rally_button_labels as Record<string, string>) ?? {},
					rally_suggested_phrases: (s.rally_suggested_phrases as Record<string, string[]>) ?? {},
					rally_show_discord_command: s.rally_show_discord_command !== false,
				});
			}

			const msg = `Imported ${Object.keys(validated).length} setting(s).`;
			setImportStatus(skipped.length > 0 ? `${msg} Skipped: ${skipped.join(', ')}` : msg);
		};
		input.click();
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
				<Field
					label="Day cutoff hour (ET, 0-23)"
					hint="Before this hour (ET), 'today' still means yesterday's session. Default: 5 (5 AM ET)."
					value={settings.day_cutoff_hour_et}
					min={0}
					max={23}
					onChange={set('day_cutoff_hour_et')}
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
						<PhrasesEditor
							phrases={settings.rally_suggested_phrases[actionType] ?? []}
							onChange={(phrases) => setRallyPhrases(actionType, phrases)}
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

			<SectionCard title="Export / Import">
				<p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '12px' }}>
					Export settings as JSON for backup, or import from a previously exported file.
				</p>
				<div style={{ display: 'flex', gap: '8px', marginBottom: importStatus ? '12px' : 0 }}>
					<button class="btn btn-secondary" onClick={handleExport}>Export</button>
					<button class="btn btn-secondary" onClick={handleImport}>Import</button>
				</div>
				{importStatus && (
					<p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{importStatus}</p>
				)}
			</SectionCard>
		</div>
	);
}
