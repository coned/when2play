import { useState, useEffect, useCallback, useRef, useMemo } from 'preact/hooks';
import { api } from '../../api/client';
import type { TreeNode, TreeEdge, Participant } from './treeConstants';
import { useTreeInteraction } from './useTreeInteraction';
import { SequenceDiagram } from './SequenceDiagram';
import { RadialGraph } from './RadialGraph';
import { NodeDetailPanel } from './NodeDetailPanel';
import { UserFilterBar } from './UserFilterBar';

interface TreeData {
	nodes: TreeNode[];
	edges: TreeEdge[];
	rallies: Array<{ id: string; day_key: string; status: string }>;
	participants: Record<string, Participant>;
}

function exportSvgToPng(svgElement: SVGSVGElement): Promise<string> {
	// Clone SVG for export-safe processing
	const clone = svgElement.cloneNode(true) as SVGSVGElement;

	// Strip <animate> elements for clean static frame
	for (const anim of Array.from(clone.querySelectorAll('animate'))) {
		anim.remove();
	}

	// Replace <image> elements with colored circle + initials (cross-origin safe)
	for (const img of Array.from(clone.querySelectorAll('image'))) {
		const parent = img.parentElement;
		if (!parent) { img.remove(); continue; }

		// Find the sibling circle for sizing reference
		const circle = parent.querySelector('circle');
		if (circle) {
			const cx = circle.getAttribute('cx') ?? '0';
			const cy = circle.getAttribute('cy') ?? '0';
			// Remove image, the initials text fallback (if any) or circle background will show through
			img.remove();

			// If there's no text sibling, add initials
			if (!parent.querySelector('text')) {
				const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
				text.setAttribute('x', cx);
				text.setAttribute('y', String(Number(cy) + 4));
				text.setAttribute('font-size', '12');
				text.setAttribute('font-weight', '600');
				text.setAttribute('fill', '#aaa');
				text.setAttribute('text-anchor', 'middle');
				text.textContent = '?';
				parent.appendChild(text);
			}
		} else {
			img.remove();
		}
	}

	// Inline CSS custom properties
	const computed = getComputedStyle(svgElement);
	const cssVarMap: Record<string, string> = {
		'var(--bg-primary)': computed.getPropertyValue('--bg-primary').trim() || '#1a1a2e',
		'var(--bg-secondary)': computed.getPropertyValue('--bg-secondary').trim() || '#252540',
		'var(--bg-tertiary)': computed.getPropertyValue('--bg-tertiary').trim() || '#2f2f50',
		'var(--text-primary)': computed.getPropertyValue('--text-primary').trim() || '#e0e0e0',
		'var(--text-secondary)': computed.getPropertyValue('--text-secondary').trim() || '#aaa',
		'var(--text-muted)': computed.getPropertyValue('--text-muted').trim() || '#666',
		'var(--border)': computed.getPropertyValue('--border').trim() || '#3a3a5c',
		'var(--accent)': computed.getPropertyValue('--accent').trim() || '#4a9eff',
	};

	// Replace CSS vars in all attributes
	const allElements = clone.querySelectorAll('*');
	for (const el of Array.from(allElements)) {
		for (const attr of Array.from(el.attributes)) {
			let val = attr.value;
			for (const [varRef, resolved] of Object.entries(cssVarMap)) {
				if (val.includes(varRef)) {
					val = val.replaceAll(varRef, resolved);
				}
			}
			if (val !== attr.value) el.setAttribute(attr.name, val);
		}
	}
	// Also handle the root SVG
	const bgStyle = clone.getAttribute('style') ?? '';
	let updatedStyle = bgStyle;
	for (const [varRef, resolved] of Object.entries(cssVarMap)) {
		updatedStyle = updatedStyle.replaceAll(varRef, resolved);
	}
	clone.setAttribute('style', updatedStyle);

	// Read the viewBox to get the logical SVG size, fall back to element dimensions
	const scale = 3;
	const vb = svgElement.viewBox?.baseVal;
	const logicalW = (vb && vb.width > 0 ? vb.width : svgElement.clientWidth) || 800;
	const logicalH = (vb && vb.height > 0 ? vb.height : svgElement.clientHeight) || 600;

	// Set explicit pixel dimensions on the clone so the browser rasterizes at high res
	clone.setAttribute('width', String(logicalW * scale));
	clone.setAttribute('height', String(logicalH * scale));

	const svgData = new XMLSerializer().serializeToString(clone);
	const canvas = document.createElement('canvas');
	const ctx = canvas.getContext('2d')!;
	const img = new Image();
	const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
	const url = URL.createObjectURL(blob);

	return new Promise((resolve, reject) => {
		img.onload = () => {
			canvas.width = img.width;
			canvas.height = img.height;
			ctx.fillStyle = cssVarMap['var(--bg-primary)'];
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

	const rawNodes: TreeNode[] = data?.nodes ?? [];
	const rawEdges: TreeEdge[] = data?.edges ?? [];
	const participants: Record<string, Participant> = data?.participants ?? {};

	const interaction = useTreeInteraction(rawNodes, rawEdges);

	const selectedNode = useMemo(() => {
		if (!interaction.selectedNodeId) return null;
		return interaction.processedNodes.find((n) => n.id === interaction.selectedNodeId) ?? null;
	}, [interaction.selectedNodeId, interaction.processedNodes]);

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
		} catch {
			setShareStatus('Failed to export tree image.');
		}

		setSharing(false);
	};

	// Day options: today + last 6 days
	const dayOptions: string[] = [];
	for (let i = 0; i < 7; i++) {
		const d = new Date();
		d.setDate(d.getDate() - i);
		dayOptions.push(d.toLocaleDateString('en-CA'));
	}

	const emptyState = rawNodes.length === 0;

	return (
		<div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
			{/* Header controls */}
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

				{/* Mode toggle */}
				<div style={{ display: 'flex', borderRadius: '6px', overflow: 'hidden', border: '1px solid var(--border)' }}>
					<ModeButton
						label="Protocol"
						active={interaction.viewMode === 'sequence'}
						onClick={() => interaction.setViewMode('sequence')}
					/>
					<ModeButton
						label="Social"
						active={interaction.viewMode === 'radial'}
						onClick={() => interaction.setViewMode('radial')}
					/>
				</div>

				<button
					class="btn btn-secondary"
					style={{ padding: '4px 12px', fontSize: '12px' }}
					onClick={handleShare}
					disabled={sharing || emptyState}
				>
					{sharing ? 'Sharing...' : 'Share to Discord'}
				</button>
				{shareStatus && (
					<span style={{ fontSize: '12px', color: shareStatus.startsWith('Failed') ? 'var(--danger)' : 'var(--success)' }}>
						{shareStatus}
					</span>
				)}
			</div>

			{/* User filter bar */}
			{!emptyState && (
				<UserFilterBar
					participantIds={interaction.participantIds}
					participants={participants}
					filterUserIds={interaction.filterUserIds}
					onToggle={interaction.toggleFilterUser}
					onClear={interaction.clearFilters}
				/>
			)}

			{/* Visualization area - fill remaining viewport */}
			<div class="card" style={{ padding: '0', overflow: 'hidden', position: 'relative', height: 'calc(100vh - 240px)', minHeight: '300px' }}>
				{emptyState ? (
					<div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
						<p style={{ fontSize: '18px', marginBottom: '8px' }}>{'\u{1F333}'} No actions yet</p>
						<p style={{ fontSize: '14px' }}>Use <code>/call</code> to start a rally and the tree will grow!</p>
					</div>
				) : interaction.viewMode === 'sequence' ? (
					<SequenceDiagram
						nodes={interaction.processedNodes}
						edges={interaction.processedEdges}
						participants={participants}
						hoveredNodeId={interaction.hoveredNodeId}
						highlightedNodeIds={interaction.highlightedNodeIds}
						highlightedEdgeIds={interaction.highlightedEdgeIds}
						onHoverNode={interaction.setHoveredNodeId}
						onClickNode={interaction.setSelectedNodeId}
						onExportRef={(fn) => { getSvgRef.current = fn; }}
					/>
				) : (
					<RadialGraph
						nodes={interaction.processedNodes}
						edges={interaction.processedEdges}
						participants={participants}
						hoveredNodeId={interaction.hoveredNodeId}
						highlightedNodeIds={interaction.highlightedNodeIds}
						highlightedEdgeIds={interaction.highlightedEdgeIds}
						onHoverNode={interaction.setHoveredNodeId}
						onClickNode={interaction.setSelectedNodeId}
						onExportRef={(fn) => { getSvgRef.current = fn; }}
					/>
				)}

				{/* Node detail overlay */}
				{selectedNode && (
					<NodeDetailPanel
						node={selectedNode}
						participants={participants}
						onClose={() => interaction.setSelectedNodeId(null)}
					/>
				)}
			</div>

			{/* Footer metadata */}
			{data && data.rallies.length > 0 && (
				<div style={{ marginTop: '12px', fontSize: '12px', color: 'var(--text-muted)' }}>
					{data.nodes.length} actions &middot; {data.edges.length} connections &middot;
					Rally: {data.rallies[0].status}
				</div>
			)}
		</div>
	);
}

function ModeButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
	return (
		<button
			onClick={onClick}
			style={{
				padding: '4px 14px',
				fontSize: '12px',
				fontWeight: active ? 700 : 500,
				background: active ? 'var(--accent, #4a9eff)' : 'var(--bg-secondary)',
				color: active ? 'white' : 'var(--text-secondary)',
				border: 'none',
				cursor: 'pointer',
				transition: 'background 0.15s',
			}}
		>
			{label}
		</button>
	);
}
