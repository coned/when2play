import { useRef, useState, useCallback, useEffect, useMemo } from 'preact/hooks';
import type { TreeNode, TreeEdge, Participant } from './treeConstants';
import {
	ANONYMOUS_ID,
	getNodeColor,
	getNodeIcon,
	formatTime,
	truncate,
	getInitials,
	isAnonymous,
} from './treeConstants';
import { computeRadialLayout, findSessionLockedNode } from './treeLayout';

interface RadialGraphProps {
	nodes: TreeNode[];
	edges: TreeEdge[];
	participants: Record<string, Participant>;
	hoveredNodeId: string | null;
	highlightedNodeIds: Set<string>;
	highlightedEdgeIds: Set<number>;
	onHoverNode: (id: string | null) => void;
	onClickNode: (id: string) => void;
	onExportRef?: (fn: () => SVGSVGElement | null) => void;
}

export function RadialGraph({
	nodes,
	edges,
	participants,
	hoveredNodeId,
	highlightedNodeIds,
	highlightedEdgeIds,
	onHoverNode,
	onClickNode,
	onExportRef,
}: RadialGraphProps) {
	const svgRef = useRef<SVGSVGElement>(null);
	const layout = useMemo(() => computeRadialLayout(nodes, edges), [nodes, edges]);
	const hasSession = useMemo(() => !!findSessionLockedNode(nodes), [nodes]);

	// Pan/zoom state
	const [viewBox, setViewBox] = useState({ x: 0, y: 0, w: 800, h: 800 });
	const [dragging, setDragging] = useState(false);
	const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

	useEffect(() => {
		if (layout.width > 0 && layout.height > 0) {
			setViewBox({ x: 0, y: 0, w: layout.width, h: layout.height });
		}
	}, [layout.width, layout.height]);

	useEffect(() => {
		if (onExportRef) onExportRef(() => svgRef.current);
	}, [onExportRef]);

	// Pan handlers
	const handleMouseDown = useCallback((e: MouseEvent) => {
		const target = e.target as Element;
		if (target === svgRef.current || target.tagName === 'svg' || target.classList?.contains('rad-bg')) {
			setDragging(true);
			setDragStart({ x: e.clientX, y: e.clientY });
		}
	}, []);

	const handleMouseMove = useCallback((e: MouseEvent) => {
		if (!dragging) return;
		const svg = svgRef.current;
		if (!svg) return;
		const dx = (e.clientX - dragStart.x) * (viewBox.w / (svg.clientWidth || 800));
		const dy = (e.clientY - dragStart.y) * (viewBox.h / (svg.clientHeight || 800));
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
		setViewBox({
			x: mx - (mx - viewBox.x) * factor,
			y: my - (my - viewBox.y) * factor,
			w: viewBox.w * factor,
			h: viewBox.h * factor,
		});
	}, [viewBox]);

	// Touch support
	const touchRef = useRef<{ startTouches: Touch[]; startViewBox: typeof viewBox } | null>(null);

	const handleTouchStart = useCallback((e: TouchEvent) => {
		if (e.touches.length >= 1) {
			touchRef.current = { startTouches: Array.from(e.touches), startViewBox: { ...viewBox } };
		}
	}, [viewBox]);

	const handleTouchMove = useCallback((e: TouchEvent) => {
		e.preventDefault();
		const t = touchRef.current;
		if (!t || !svgRef.current) return;

		if (e.touches.length === 1 && t.startTouches.length >= 1) {
			const svg = svgRef.current;
			const dx = (e.touches[0].clientX - t.startTouches[0].clientX) * (t.startViewBox.w / (svg.clientWidth || 800));
			const dy = (e.touches[0].clientY - t.startTouches[0].clientY) * (t.startViewBox.h / (svg.clientHeight || 800));
			setViewBox({ ...t.startViewBox, x: t.startViewBox.x - dx, y: t.startViewBox.y - dy });
		} else if (e.touches.length === 2 && t.startTouches.length >= 2) {
			const startDist = Math.hypot(
				t.startTouches[1].clientX - t.startTouches[0].clientX,
				t.startTouches[1].clientY - t.startTouches[0].clientY,
			);
			const curDist = Math.hypot(
				e.touches[1].clientX - e.touches[0].clientX,
				e.touches[1].clientY - e.touches[0].clientY,
			);
			if (startDist === 0) return;
			const scale = startDist / curDist;
			const svg = svgRef.current;
			const rect = svg.getBoundingClientRect();
			const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
			const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
			const mx = ((midX - rect.left) / rect.width) * t.startViewBox.w + t.startViewBox.x;
			const my = ((midY - rect.top) / rect.height) * t.startViewBox.h + t.startViewBox.y;
			const nw = t.startViewBox.w * scale;
			const nh = t.startViewBox.h * scale;
			setViewBox({
				x: mx - (mx - t.startViewBox.x) * scale,
				y: my - (my - t.startViewBox.y) * scale,
				w: nw,
				h: nh,
			});
		}
	}, []);

	const handleTouchEnd = useCallback(() => { touchRef.current = null; }, []);

	// Tap-hold for mobile hover
	const holdTimerRef = useRef<number | null>(null);
	const handleNodeTouchStart = useCallback((nodeId: string) => {
		holdTimerRef.current = window.setTimeout(() => { onHoverNode(nodeId); }, 600);
	}, [onHoverNode]);
	const handleNodeTouchEnd = useCallback(() => {
		if (holdTimerRef.current !== null) {
			clearTimeout(holdTimerRef.current);
			holdTimerRef.current = null;
		}
	}, []);

	const hasHighlight = hoveredNodeId !== null;
	const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

	// Collect unique ring radii for reference circles (derive from actual node positions)
	const ringRadii = useMemo(() => {
		const map = new Map<number, number>();
		for (const pos of layout.nodePositions.values()) {
			if (pos.ring > 0 && !map.has(pos.ring)) {
				// Compute distance from center to get the actual ring radius
				const dx = pos.x - layout.centerX;
				const dy = pos.y - layout.centerY;
				map.set(pos.ring, Math.sqrt(dx * dx + dy * dy));
			}
		}
		return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
	}, [layout.nodePositions, layout.centerX, layout.centerY]);

	if (nodes.length === 0) return null;

	return (
		<svg
			ref={svgRef}
			viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
			style={{ width: '100%', height: '100%', background: 'var(--bg-primary)', borderRadius: '8px', cursor: dragging ? 'grabbing' : 'grab', userSelect: 'none' }}
			onMouseDown={handleMouseDown}
			onMouseMove={handleMouseMove}
			onMouseUp={handleMouseUp}
			onMouseLeave={handleMouseUp}
			onWheel={handleWheel}
			onTouchStart={handleTouchStart}
			onTouchMove={handleTouchMove}
			onTouchEnd={handleTouchEnd}
		>
			<defs>
				{/* Glow filters */}
				<filter id="glow-blue" x="-50%" y="-50%" width="200%" height="200%">
					<feGaussianBlur stdDeviation="4" result="blur" />
					<feFlood floodColor="#4a9eff" floodOpacity="0.4" result="color" />
					<feComposite in="color" in2="blur" operator="in" result="glow" />
					<feComposite in="SourceGraphic" in2="glow" operator="over" />
				</filter>
				<filter id="glow-green" x="-50%" y="-50%" width="200%" height="200%">
					<feGaussianBlur stdDeviation="3" result="blur" />
					<feFlood floodColor="#4caf50" floodOpacity="0.4" result="color" />
					<feComposite in="color" in2="blur" operator="in" result="glow" />
					<feComposite in="SourceGraphic" in2="glow" operator="over" />
				</filter>
				{/* Arrowheads */}
				<marker id="rad-arrow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
					<polygon points="0 0, 8 3, 0 6" fill="var(--text-muted)" opacity="0.5" />
				</marker>
				<marker id="rad-arrow-ping" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
					<polygon points="0 0, 8 3, 0 6" fill="#ff9800" opacity="0.5" />
				</marker>
			</defs>

			{/* Background for pan */}
			<rect class="rad-bg" x={viewBox.x} y={viewBox.y} width={viewBox.w} height={viewBox.h} fill="transparent" />

			{/* Subtle ring reference circles */}
			{ringRadii.map(([ring, radius]) => (
				<circle
					key={`ring-${ring}`}
					cx={layout.centerX}
					cy={layout.centerY}
					r={radius}
					fill="none"
					stroke="var(--text-muted)"
					strokeWidth={0.5}
					opacity={0.12}
					strokeDasharray="4,8"
				/>
			))}

			{/* Edges */}
			{layout.edgePaths.map((ep, i) => {
				const dimmed = hasHighlight && !highlightedEdgeIds.has(i);
				const isPing = ep.edge.type === 'ping';
				const targetNode = nodeMap.get(ep.edge.target);
				const color = isPing ? '#ff9800' : getNodeColor(targetNode?.action_type ?? 'call');

				return (
					<path
						key={`edge-${i}`}
						d={ep.path}
						fill="none"
						stroke={color}
						strokeWidth={isPing ? 1.5 : 2}
						strokeDasharray={isPing ? '6,4' : undefined}
						opacity={dimmed ? 0.08 : 0.4}
						markerEnd={isPing ? 'url(#rad-arrow-ping)' : 'url(#rad-arrow)'}
					/>
				);
			})}

			{/* Session Established pulsing ring */}
			{hasSession && (() => {
				const callNode = nodes.find((n) => n.action_type === 'call');
				const callPos = callNode ? layout.nodePositions.get(callNode.id) : undefined;
				if (!callPos) return null;
				return (
					<circle
						cx={callPos.x}
						cy={callPos.y}
						r={callPos.radius + 10}
						fill="none"
						stroke="#26a69a"
						strokeWidth={2}
						opacity={0.6}
					>
						<animate attributeName="stroke-opacity" values="0.6;0.15;0.6" dur="2.5s" repeatCount="indefinite" />
						<animate attributeName="r" values={`${callPos.radius + 8};${callPos.radius + 14};${callPos.radius + 8}`} dur="2.5s" repeatCount="indefinite" />
					</circle>
				);
			})()}

			{/* Nodes */}
			{nodes.map((node) => {
				const pos = layout.nodePositions.get(node.id);
				if (!pos) return null;

				const color = getNodeColor(node.action_type);
				const icon = getNodeIcon(node.action_type);
				const dimmed = hasHighlight && !highlightedNodeIds.has(node.id);
				const r = pos.radius;
				const isCall = node.action_type === 'call';
				const isIn = node.action_type === 'in';
				const username = isAnonymous(node) ? node.actor_username : (participants[node.actor_id]?.username ?? node.actor_username);
				const glowFilter = isCall ? 'url(#glow-blue)' : isIn ? 'url(#glow-green)' : undefined;
				const badgeR = r > 22 ? 9 : 7;

				return (
					<g
						key={node.id}
						opacity={dimmed ? 0.12 : 1}
						style={{ cursor: 'pointer' }}
						onMouseEnter={() => onHoverNode(node.id)}
						onMouseLeave={() => onHoverNode(null)}
						onClick={() => onClickNode(node.id)}
						onTouchStart={() => handleNodeTouchStart(node.id)}
						onTouchEnd={handleNodeTouchEnd}
						filter={glowFilter}
					>
						{/* Node circle with subtle color tint */}
						<circle cx={pos.x} cy={pos.y} r={r} fill="var(--bg-secondary)" stroke={color} strokeWidth={isCall ? 3 : 2} />
						<circle cx={pos.x} cy={pos.y} r={r - 1} fill={color} opacity={0.1} />

						{/* Initials */}
						<text
							x={pos.x}
							y={pos.y + (r > 28 ? 6 : r > 22 ? 5 : 4)}
							fontSize={r > 28 ? 14 : r > 22 ? 12 : 10}
							fontWeight="700"
							fill={color}
							textAnchor="middle"
						>
							{getInitials(username)}
						</text>

						{/* Action type badge (bottom-right) */}
						<circle cx={pos.x + r * 0.65} cy={pos.y + r * 0.65} r={badgeR} fill={color} />
						<text
							x={pos.x + r * 0.65}
							y={pos.y + r * 0.65 + (badgeR > 8 ? 3.5 : 3)}
							fontSize={badgeR > 8 ? '9' : '8'}
							textAnchor="middle"
							fill="white"
						>
							{icon}
						</text>

						{/* Username label below */}
						<text x={pos.x} y={pos.y + r + 14} fontSize="10" fontWeight="600" fill="var(--text-primary)" textAnchor="middle">
							{truncate(username, 12)}
						</text>

						{/* Time below name */}
						<text x={pos.x} y={pos.y + r + 25} fontSize="8" fill="var(--text-muted)" textAnchor="middle">
							{formatTime(node.created_at)}
						</text>

						{/* Anonymous count badge */}
						{node.id === ANONYMOUS_ID && node.metadata?.count && (
							<>
								<circle cx={pos.x - r * 0.65} cy={pos.y - r * 0.65} r={10} fill="#666" />
								<text x={pos.x - r * 0.65} y={pos.y - r * 0.65 + 4} fontSize="9" fontWeight="700" fill="white" textAnchor="middle">
									x{String(node.metadata.count)}
								</text>
							</>
						)}
					</g>
				);
			})}
		</svg>
	);
}
