import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { api } from '../../api/client';
import { localToday } from '../../lib/time';
import { TreeVisualization } from './TreeVisualization';

interface TreeData {
	nodes: Array<{
		id: string;
		action_type: string;
		actor_id: string;
		actor_username: string;
		actor_avatar: string | null;
		target_user_ids: string[] | null;
		message: string | null;
		metadata: Record<string, unknown> | null;
		created_at: string;
	}>;
	edges: Array<{ source: string; target: string; type: 'response' | 'ping' | 'sequence' }>;
	rallies: Array<{ id: string; day_key: string; status: string }>;
}

async function exportSvgToPng(svgElement: SVGSVGElement): Promise<string> {
	const svgData = new XMLSerializer().serializeToString(svgElement);
	const canvas = document.createElement('canvas');
	const ctx = canvas.getContext('2d')!;
	const img = new Image();
	const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
	const url = URL.createObjectURL(blob);

	return new Promise((resolve, reject) => {
		img.onload = () => {
			canvas.width = img.width || 800;
			canvas.height = img.height || 600;
			ctx.fillStyle = '#1a1a2e';
			ctx.fillRect(0, 0, canvas.width, canvas.height);
			ctx.drawImage(img, 0, 0);
			URL.revokeObjectURL(url);
			const dataUrl = canvas.toDataURL('image/png');
			resolve(dataUrl.split(',')[1]);
		};
		img.onerror = () => {
			URL.revokeObjectURL(url);
			reject(new Error('Failed to render SVG to image'));
		};
		img.src = url;
	});
}

export function GamingTree() {
	const [data, setData] = useState<TreeData | null>(null);
	const [dayKey, setDayKey] = useState('');
	const [sharing, setSharing] = useState(false);
	const [shareStatus, setShareStatus] = useState('');
	const getSvgRef = useRef<(() => SVGSVGElement | null) | null>(null);

	const fetchTree = useCallback(async () => {
		const result = await api.getTreeData(dayKey || undefined);
		if (result.ok) setData(result.data);
	}, [dayKey]);

	useEffect(() => {
		fetchTree();
		const interval = setInterval(fetchTree, 20_000);
		return () => clearInterval(interval);
	}, [fetchTree]);

	const handleShare = async () => {
		if (!getSvgRef.current) return;
		const svg = getSvgRef.current();
		if (!svg) return;

		setSharing(true);
		setShareStatus('');

		try {
			const base64 = await exportSvgToPng(svg);
			const result = await api.shareTree({ image_data: base64 });
			if (result.ok) {
				setShareStatus('Tree shared to Discord!');
			} else {
				setShareStatus(`Failed: ${result.error.message}`);
			}
		} catch (err) {
			setShareStatus('Failed to export tree image.');
		}

		setSharing(false);
	};

	// Generate day options (today + last 6 days)
	const dayOptions: string[] = [];
	for (let i = 0; i < 7; i++) {
		const d = new Date();
		d.setDate(d.getDate() - i);
		dayOptions.push(d.toLocaleDateString('en-CA'));
	}

	return (
		<div>
			<div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
				<h2 style={{ margin: 0 }}>Gaming Tree</h2>
				<select
					value={dayKey}
					onChange={(e) => setDayKey((e.target as HTMLSelectElement).value)}
					style={{ padding: '4px 8px', fontSize: '13px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '4px' }}
				>
					<option value="">Today</option>
					{dayOptions.map((d) => (
						<option key={d} value={d}>{d}</option>
					))}
				</select>
				<button
					class="btn btn-secondary"
					style={{ padding: '4px 12px', fontSize: '12px' }}
					onClick={handleShare}
					disabled={sharing || !data?.nodes.length}
				>
					{sharing ? 'Sharing...' : 'Share to Discord'}
				</button>
				{shareStatus && (
					<span style={{ fontSize: '12px', color: shareStatus.startsWith('Failed') ? 'var(--danger)' : 'var(--success)' }}>
						{shareStatus}
					</span>
				)}
			</div>

			<div class="card" style={{ padding: '0', overflow: 'hidden' }}>
				<TreeVisualization
					nodes={data?.nodes ?? []}
					edges={data?.edges ?? []}
					onExportRef={(fn) => { getSvgRef.current = fn; }}
				/>
			</div>

			{data && data.rallies.length > 0 && (
				<div style={{ marginTop: '12px', fontSize: '12px', color: 'var(--text-muted)' }}>
					{data.nodes.length} actions &middot; {data.edges.length} connections &middot;
					Rally: {data.rallies[0].status}
				</div>
			)}
		</div>
	);
}
