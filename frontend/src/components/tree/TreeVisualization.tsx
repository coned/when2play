import { useRef, useState, useEffect, useCallback } from 'preact/hooks';
import * as dagre from '@dagrejs/dagre';

interface TreeNode {
	id: string;
	action_type: string;
	actor_id: string;
	actor_username: string;
	actor_avatar: string | null;
	target_user_ids: string[] | null;
	message: string | null;
	metadata: Record<string, unknown> | null;
	created_at: string;
}

interface TreeEdge {
	source: string;
	target: string;
	type: 'response' | 'ping' | 'sequence';
}

interface TreeVisualizationProps {
	nodes: TreeNode[];
	edges: TreeEdge[];
	onExportRef?: (fn: () => SVGSVGElement | null) => void;
}

const NODE_WIDTH = 180;
const NODE_HEIGHT = 64;

const ACTION_COLORS: Record<string, string> = {
	call: '#4a9eff',
	in: '#4caf50',
	out: '#f44336',
	ping: '#ff9800',
	brb: '#ffc107',
	where: '#9c27b0',
	judge_time: '#26a69a',
	judge_avail: '#26a69a',
};

const ACTION_ICONS: Record<string, string> = {
	call: '\u{1F4E2}',
	in: '\u2705',
	out: '\u274C',
	ping: '\u{1F44B}',
	brb: '\u23F3',
	where: '\u2753',
	judge_time: '\u{1F916}',
	judge_avail: '\u{1F916}',
};

function formatTime(iso: string): string {
	const d = new Date(iso);
	return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function truncate(str: string, max: number): string {
	return str.length > max ? str.slice(0, max - 1) + '\u2026' : str;
}

export function TreeVisualization({ nodes, edges, onExportRef }: TreeVisualizationProps) {
	const svgRef = useRef<SVGSVGElement>(null);
	const [viewBox, setViewBox] = useState({ x: 0, y: 0, w: 800, h: 600 });
	const [dragging, setDragging] = useState(false);
	const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
	const [layout, setLayout] = useState<{
		nodePositions: Map<string, { x: number; y: number }>;
		graphWidth: number;
		graphHeight: number;
	} | null>(null);

	// Compute layout with dagre
	useEffect(() => {
		if (nodes.length === 0) {
			setLayout(null);
			return;
		}

		const g = new dagre.graphlib.Graph();
		g.setGraph({ rankdir: 'LR', ranksep: 80, nodesep: 40, marginx: 40, marginy: 40 });
		g.setDefaultEdgeLabel(() => ({}));

		for (const node of nodes) {
			g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
		}
		for (const edge of edges) {
			g.setEdge(edge.source, edge.target);
		}

		dagre.layout(g);

		const positions = new Map<string, { x: number; y: number }>();
		for (const nodeId of g.nodes()) {
			const n = g.node(nodeId);
			if (n) positions.set(nodeId, { x: n.x, y: n.y });
		}

		const graphInfo = g.graph();
		const gw = (graphInfo?.width ?? 800) + 80;
		const gh = (graphInfo?.height ?? 600) + 80;

		setLayout({ nodePositions: positions, graphWidth: gw, graphHeight: gh });
		setViewBox({ x: 0, y: 0, w: gw, h: gh });
	}, [nodes, edges]);

	// Export ref
	useEffect(() => {
		if (onExportRef) {
			onExportRef(() => svgRef.current);
		}
	}, [onExportRef]);

	// Pan handlers
	const handleMouseDown = useCallback((e: MouseEvent) => {
		if (e.target === svgRef.current || (e.target as Element)?.tagName === 'svg' || (e.target as Element)?.classList?.contains('tree-bg')) {
			setDragging(true);
			setDragStart({ x: e.clientX, y: e.clientY });
		}
	}, []);

	const handleMouseMove = useCallback((e: MouseEvent) => {
		if (!dragging) return;
		const dx = (e.clientX - dragStart.x) * (viewBox.w / (svgRef.current?.clientWidth ?? 800));
		const dy = (e.clientY - dragStart.y) * (viewBox.h / (svgRef.current?.clientHeight ?? 600));
		setViewBox((v) => ({ ...v, x: v.x - dx, y: v.y - dy }));
		setDragStart({ x: e.clientX, y: e.clientY });
	}, [dragging, dragStart, viewBox]);

	const handleMouseUp = useCallback(() => setDragging(false), []);

	const handleWheel = useCallback((e: WheelEvent) => {
		e.preventDefault();
		const factor = e.deltaY > 0 ? 1.1 : 0.9;
		const svg = svgRef.current;
		if (!svg) return;
		const rect = svg.getBoundingClientRect();
		const mx = ((e.clientX - rect.left) / rect.width) * viewBox.w + viewBox.x;
		const my = ((e.clientY - rect.top) / rect.height) * viewBox.h + viewBox.y;
		const nw = viewBox.w * factor;
		const nh = viewBox.h * factor;
		setViewBox({
			x: mx - (mx - viewBox.x) * factor,
			y: my - (my - viewBox.y) * factor,
			w: nw,
			h: nh,
		});
	}, [viewBox]);

	if (nodes.length === 0) {
		return (
			<div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
				<p style={{ fontSize: '18px', marginBottom: '8px' }}>{'\u{1F333}'} No actions yet</p>
				<p style={{ fontSize: '14px' }}>Use <code>/call</code> to start a rally and the tree will grow!</p>
			</div>
		);
	}

	const nodeMap = new Map(nodes.map((n) => [n.id, n]));

	return (
		<svg
			ref={svgRef}
			viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
			style={{ width: '100%', height: '500px', background: 'var(--bg-primary)', borderRadius: '8px', cursor: dragging ? 'grabbing' : 'grab' }}
			onMouseDown={handleMouseDown}
			onMouseMove={handleMouseMove}
			onMouseUp={handleMouseUp}
			onMouseLeave={handleMouseUp}
			onWheel={handleWheel}
		>
			<defs>
				<marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
					<polygon points="0 0, 8 3, 0 6" fill="var(--text-muted)" />
				</marker>
				<marker id="arrowhead-dashed" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
					<polygon points="0 0, 8 3, 0 6" fill="#ff9800" opacity="0.6" />
				</marker>
			</defs>

			{/* Background */}
			<rect class="tree-bg" x={viewBox.x} y={viewBox.y} width={viewBox.w} height={viewBox.h} fill="transparent" />

			{/* Edges */}
			{layout && edges.map((edge, i) => {
				const src = layout.nodePositions.get(edge.source);
				const tgt = layout.nodePositions.get(edge.target);
				if (!src || !tgt) return null;

				const isDashed = edge.type === 'ping';
				const x1 = src.x + NODE_WIDTH / 2;
				const y1 = src.y;
				const x2 = tgt.x - NODE_WIDTH / 2;
				const y2 = tgt.y;
				const cx1 = x1 + (x2 - x1) * 0.4;
				const cx2 = x2 - (x2 - x1) * 0.4;

				return (
					<path
						key={`edge-${i}`}
						d={`M ${x1} ${y1} C ${cx1} ${y1}, ${cx2} ${y2}, ${x2} ${y2}`}
						fill="none"
						stroke={isDashed ? '#ff9800' : 'var(--text-muted)'}
						strokeWidth={isDashed ? 1.5 : 2}
						strokeDasharray={isDashed ? '6,4' : undefined}
						opacity={isDashed ? 0.6 : 0.4}
						markerEnd={isDashed ? 'url(#arrowhead-dashed)' : 'url(#arrowhead)'}
					/>
				);
			})}

			{/* Nodes */}
			{layout && nodes.map((node) => {
				const pos = layout.nodePositions.get(node.id);
				if (!pos) return null;
				const color = ACTION_COLORS[node.action_type] ?? '#888';
				const icon = ACTION_ICONS[node.action_type] ?? '\u2022';
				const x = pos.x - NODE_WIDTH / 2;
				const y = pos.y - NODE_HEIGHT / 2;

				return (
					<g key={node.id}>
						<rect
							x={x}
							y={y}
							width={NODE_WIDTH}
							height={NODE_HEIGHT}
							rx={8}
							fill="var(--bg-secondary)"
							stroke={color}
							strokeWidth={2}
						/>
						{/* Icon */}
						<text x={x + 10} y={y + 20} fontSize="14" fill={color}>
							{icon}
						</text>
						{/* Username */}
						<text x={x + 30} y={y + 20} fontSize="12" fontWeight="600" fill="var(--text-primary)">
							{truncate(node.metadata?.is_anonymous ? 'Someone' : (node.actor_username ?? 'Unknown'), 14)}
						</text>
						{/* Time */}
						<text x={x + NODE_WIDTH - 8} y={y + 20} fontSize="10" fill="var(--text-muted)" textAnchor="end">
							{formatTime(node.created_at)}
						</text>
						{/* Action type + message */}
						<text x={x + 10} y={y + 42} fontSize="10" fill="var(--text-secondary)">
							{node.action_type}{node.message ? `: ${truncate(node.message, 18)}` : ''}
						</text>
					</g>
				);
			})}
		</svg>
	);
}
