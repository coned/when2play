import { useRef, useState, useCallback, useEffect, useMemo } from 'preact/hooks';
import type { TreeNode, TreeEdge, Participant } from './treeConstants';
import {
	MARGIN,
	LANE_HEADER_HEIGHT,
	getNodeColor,
	getNodeIcon,
	getNodeLabel,
	formatTime,
	truncate,
	getInitials,
} from './treeConstants';
import { computeSequenceLayout } from './treeLayout';

interface SequenceDiagramProps {
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

export function SequenceDiagram({
	nodes,
	edges,
	participants,
	hoveredNodeId,
	highlightedNodeIds,
	highlightedEdgeIds,
	onHoverNode,
	onClickNode,
	onExportRef,
}: SequenceDiagramProps) {
	const svgRef = useRef<SVGSVGElement>(null);
	const layout = useMemo(() => computeSequenceLayout(nodes, edges, participants), [nodes, edges, participants]);

	// Lane lookup: user ID -> lane X
	const laneLookup = useMemo(() => {
		const map = new Map<string, number>();
		for (const lane of layout.lanes) {
			map.set(lane.id, lane.x);
		}
		return map;
	}, [layout.lanes]);

	// Pan/zoom state
	const [viewBox, setViewBox] = useState({ x: 0, y: 0, w: 800, h: 600 });
	const [dragging, setDragging] = useState(false);
	const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

	// Reset viewBox when layout changes
	useEffect(() => {
		if (layout.width > 0 && layout.height > 0) {
			setViewBox({ x: 0, y: 0, w: layout.width, h: layout.height });
		}
	}, [layout.width, layout.height]);

	// Export ref
	useEffect(() => {
		if (onExportRef) onExportRef(() => svgRef.current);
	}, [onExportRef]);

	// Pan handlers
	const handleMouseDown = useCallback((e: MouseEvent) => {
		const target = e.target as Element;
		if (target === svgRef.current || target.tagName === 'svg' || target.classList?.contains('seq-bg')) {
			setDragging(true);
			setDragStart({ x: e.clientX, y: e.clientY });
		}
	}, []);

	const handleMouseMove = useCallback((e: MouseEvent) => {
		if (!dragging) return;
		const svg = svgRef.current;
		if (!svg) return;
		const dx = (e.clientX - dragStart.x) * (viewBox.w / (svg.clientWidth || 800));
		const dy = (e.clientY - dragStart.y) * (viewBox.h / (svg.clientHeight || 600));
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

	// Touch pan/zoom
	const touchRef = useRef<{ startTouches: Touch[]; startViewBox: typeof viewBox } | null>(null);

	const handleTouchStart = useCallback((e: TouchEvent) => {
		if (e.touches.length >= 1) {
			touchRef.current = {
				startTouches: Array.from(e.touches),
				startViewBox: { ...viewBox },
			};
		}
	}, [viewBox]);

	const handleTouchMove = useCallback((e: TouchEvent) => {
		e.preventDefault();
		const t = touchRef.current;
		if (!t || !svgRef.current) return;

		if (e.touches.length === 1 && t.startTouches.length >= 1) {
			const svg = svgRef.current;
			const dx = (e.touches[0].clientX - t.startTouches[0].clientX) * (t.startViewBox.w / (svg.clientWidth || 800));
			const dy = (e.touches[0].clientY - t.startTouches[0].clientY) * (t.startViewBox.h / (svg.clientHeight || 600));
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

	// Collect all clipPath IDs needed for lane avatars
	const avatarLanes = useMemo(
		() => layout.lanes.filter((l) => l.avatar),
		[layout.lanes],
	);

	if (nodes.length === 0) return null;

	const AVATAR_CY = MARGIN + 22;
	const AVATAR_R = 16;

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
				{/* Arrowhead markers */}
				<marker id="seq-arrow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
					<polygon points="0 0, 8 3, 0 6" fill="var(--text-muted)" />
				</marker>
				<marker id="seq-arrow-response-in" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
					<polygon points="0 0, 8 3, 0 6" fill="#4caf50" />
				</marker>
				<marker id="seq-arrow-response-out" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
					<polygon points="0 0, 8 3, 0 6" fill="#f44336" />
				</marker>
				<marker id="seq-arrow-response-brb" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
					<polygon points="0 0, 8 3, 0 6" fill="#ffc107" />
				</marker>
				<marker id="seq-arrow-ping" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
					<polygon points="0 0, 8 3, 0 6" fill="#ff9800" opacity="0.7" />
				</marker>
				<marker id="seq-arrow-sequence" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
					<polygon points="0 0, 8 3, 0 6" fill="#26a69a" />
				</marker>
				{/* Target arrow markers - userSpaceOnUse for fixed visible size */}
				<marker id="seq-arrow-target-ping" markerWidth="12" markerHeight="8" refX="12" refY="4" orient="auto" markerUnits="userSpaceOnUse">
					<polygon points="0 0, 12 4, 0 8" fill="#ff9800" />
				</marker>
				<marker id="seq-arrow-target-where" markerWidth="12" markerHeight="8" refX="12" refY="4" orient="auto" markerUnits="userSpaceOnUse">
					<polygon points="0 0, 12 4, 0 8" fill="#9c27b0" />
				</marker>
				<marker id="seq-arrow-target-judge" markerWidth="12" markerHeight="8" refX="12" refY="4" orient="auto" markerUnits="userSpaceOnUse">
					<polygon points="0 0, 12 4, 0 8" fill="#26a69a" />
				</marker>
				<marker id="seq-arrow-target-default" markerWidth="12" markerHeight="8" refX="12" refY="4" orient="auto" markerUnits="userSpaceOnUse">
					<polygon points="0 0, 12 4, 0 8" fill="var(--text-secondary)" />
				</marker>
				{/* Glow filter for session banner */}
				<filter id="session-glow" x="-20%" y="-50%" width="140%" height="200%">
					<feGaussianBlur stdDeviation="6" result="blur" />
					<feComposite in="SourceGraphic" in2="blur" operator="over" />
				</filter>
				{/* Avatar clip paths (must be in defs for cross-browser support) */}
				{avatarLanes.map((lane) => (
					<clipPath key={`clip-${lane.id}`} id={`avatar-clip-${lane.id}`}>
						<circle cx={lane.x} cy={AVATAR_CY} r={AVATAR_R} />
					</clipPath>
				))}
			</defs>

			{/* Background for pan */}
			<rect class="seq-bg" x={viewBox.x} y={viewBox.y} width={viewBox.w} height={viewBox.h} fill="transparent" />

			{/* Lane dashed lines */}
			{layout.lanes.map((lane) => (
				<line
					key={`lane-${lane.id}`}
					x1={lane.x}
					y1={MARGIN + LANE_HEADER_HEIGHT - 10}
					x2={lane.x}
					y2={layout.height}
					stroke="var(--text-muted)"
					strokeWidth={1}
					strokeDasharray="4,6"
					opacity={0.25}
				/>
			))}

			{/* Lane headers - avatar + name centered together */}
			{layout.lanes.map((lane) => (
				<g key={`header-${lane.id}`}>
					{lane.avatar ? (
						<>
							<circle cx={lane.x} cy={AVATAR_CY} r={AVATAR_R} fill="var(--bg-tertiary)" stroke="var(--border)" strokeWidth={1.5} />
							<image
								href={lane.avatar}
								x={lane.x - AVATAR_R}
								y={AVATAR_CY - AVATAR_R}
								width={AVATAR_R * 2}
								height={AVATAR_R * 2}
								clipPath={`url(#avatar-clip-${lane.id})`}
							/>
						</>
					) : (
						<>
							<circle cx={lane.x} cy={AVATAR_CY} r={AVATAR_R} fill="var(--bg-tertiary)" stroke="var(--border)" strokeWidth={1.5} />
							<text x={lane.x} y={AVATAR_CY + 4} fontSize="11" fontWeight="600" fill="var(--text-secondary)" textAnchor="middle">
								{getInitials(lane.label)}
							</text>
						</>
					)}
					<text x={lane.x} y={AVATAR_CY + AVATAR_R + 14} fontSize="11" fontWeight="600" fill="var(--text-primary)" textAnchor="middle">
						{truncate(lane.label, 14)}
					</text>
				</g>
			))}

			{/* Session Locked banner */}
			{layout.sessionBannerY !== null && (
				<g filter="url(#session-glow)">
					<rect
						x={MARGIN}
						y={layout.sessionBannerY - 14}
						width={layout.width - MARGIN * 2}
						height={28}
						rx={4}
						fill="#26a69a"
						opacity={0.15}
					/>
					<line
						x1={MARGIN}
						y1={layout.sessionBannerY}
						x2={layout.width - MARGIN}
						y2={layout.sessionBannerY}
						stroke="#26a69a"
						strokeWidth={2}
						opacity={0.5}
					/>
					<text
						x={layout.width / 2}
						y={layout.sessionBannerY + 4}
						fontSize="10"
						fontWeight="700"
						fill="#26a69a"
						textAnchor="middle"
						opacity={0.8}
					>
						SESSION LOCKED
					</text>
				</g>
			)}

			{/* Arrows (edges) */}
			{layout.arrows.map((arrow, i) => {
				const edge = arrow.edge;
				const targetNode = nodeMap.get(edge.target);
				const targetType = targetNode?.action_type ?? '';

				let stroke: string;
				let strokeDasharray: string | undefined;
				let markerEnd: string;
				let strokeWidth = 2;

				if (edge.type === 'ping') {
					stroke = '#ff9800';
					strokeDasharray = '6,4';
					markerEnd = 'url(#seq-arrow-ping)';
					strokeWidth = 1.5;
				} else if (edge.type === 'sequence') {
					stroke = '#26a69a';
					markerEnd = 'url(#seq-arrow-sequence)';
				} else {
					if (targetType === 'in') {
						stroke = '#4caf50';
						markerEnd = 'url(#seq-arrow-response-in)';
					} else if (targetType === 'out') {
						stroke = '#f44336';
						markerEnd = 'url(#seq-arrow-response-out)';
					} else if (targetType === 'brb') {
						stroke = '#ffc107';
						markerEnd = 'url(#seq-arrow-response-brb)';
					} else {
						stroke = 'var(--text-muted)';
						markerEnd = 'url(#seq-arrow)';
					}
				}

				const dx = arrow.x2 - arrow.x1;
				const dy = arrow.y2 - arrow.y1;
				const curveOffset = dx === 0 ? 0 : (dy > 0 ? 20 : -20);
				const mx = (arrow.x1 + arrow.x2) / 2;
				const my = (arrow.y1 + arrow.y2) / 2 + curveOffset;

				const dimmed = hasHighlight && !highlightedEdgeIds.has(i);

				return (
					<path
						key={`edge-${i}`}
						d={`M ${arrow.x1} ${arrow.y1} Q ${mx} ${my} ${arrow.x2} ${arrow.y2}`}
						fill="none"
						stroke={stroke}
						strokeWidth={strokeWidth}
						strokeDasharray={strokeDasharray}
						opacity={dimmed ? 0.1 : 0.7}
						markerEnd={markerEnd}
					/>
				);
			})}

			{/* Target arrows for ping/where/judge_avail - fan-out from source to target lanes */}
			{nodes.map((node) => {
				if (!node.target_user_ids || node.target_user_ids.length === 0) return null;
				const pos = layout.nodePositions.get(node.id);
				if (!pos) return null;
				const dimmed = hasHighlight && !highlightedNodeIds.has(node.id);
				const color = getNodeColor(node.action_type);
				const opacity = dimmed ? 0.1 : 0.45;
				const at = node.action_type;
				const markerRef = at === 'ping' ? 'url(#seq-arrow-target-ping)' : at === 'where' ? 'url(#seq-arrow-target-where)' : (at === 'judge_avail' || at === 'judge_time') ? 'url(#seq-arrow-target-judge)' : 'url(#seq-arrow-target-default)';

				// Resolve valid targets (those with a visible lane)
				const targets = node.target_user_ids
					.map((tid) => ({ tid, laneX: laneLookup.get(tid) }))
					.filter((t): t is { tid: string; laneX: number } => t.laneX !== undefined);
				if (targets.length === 0) return null;

				const baseY = pos.y + 4;

				// Single target: simple arrow or self-loop
				if (targets.length === 1) {
					const { laneX } = targets[0];
					if (laneX === pos.x) {
						// Self-ping: loopback arc
						const loopR = 12;
						return (
							<path
								key={`target-${node.id}-0`}
								d={`M ${pos.x + 6} ${baseY - 3} C ${pos.x + 6 + loopR * 2} ${baseY - loopR - 3}, ${pos.x + 6 + loopR * 2} ${baseY + loopR - 3}, ${pos.x + 6} ${baseY + 3}`}
								fill="none"
								stroke={color}
								strokeWidth={1.2}
								strokeDasharray="3,3"
								opacity={opacity}
								markerEnd={markerRef}
							/>
						);
					}
					const goRight = laneX > pos.x;
					return (
						<line
							key={`target-${node.id}-0`}
							x1={pos.x + (goRight ? 8 : -8)}
							y1={baseY}
							x2={laneX + (goRight ? -4 : 4)}
							y2={baseY}
							stroke={color}
							strokeWidth={1.2}
							strokeDasharray="3,3"
							opacity={opacity}
							markerEnd={markerRef}
						/>
					);
				}

				// Multiple targets: fan-out with curved joints at source
				const SPREAD = 8;
				const BEND = 18;
				const halfSpread = ((targets.length - 1) * SPREAD) / 2;

				return targets.map((t, idx) => {
					const yOffset = -halfSpread + idx * SPREAD;
					const arrowY = baseY + yOffset;

					if (t.laneX === pos.x) {
						// Self-ping in multi-target
						const loopR = 10;
						return (
							<path
								key={`target-${node.id}-${idx}`}
								d={`M ${pos.x + 6} ${arrowY - 2} C ${pos.x + 6 + loopR * 2} ${arrowY - loopR - 2}, ${pos.x + 6 + loopR * 2} ${arrowY + loopR - 2}, ${pos.x + 6} ${arrowY + 2}`}
								fill="none"
								stroke={color}
								strokeWidth={1.2}
								strokeDasharray="3,3"
								opacity={opacity}
								markerEnd={markerRef}
							/>
						);
					}

					const goRight = t.laneX > pos.x;
					const dir = goRight ? 1 : -1;
					const fromX = pos.x + dir * 8;
					const toX = t.laneX - dir * 4;

					if (Math.abs(yOffset) < 0.5) {
						// Center arrow: straight horizontal
						return (
							<line
								key={`target-${node.id}-${idx}`}
								x1={fromX}
								y1={baseY}
								x2={toX}
								y2={baseY}
								stroke={color}
								strokeWidth={1.2}
								strokeDasharray="3,3"
								opacity={opacity}
								markerEnd={markerRef}
							/>
						);
					}

					// Curved path: departs horizontally, bends to offset Y, continues horizontally to target
					return (
						<path
							key={`target-${node.id}-${idx}`}
							d={`M ${fromX} ${baseY} C ${fromX + dir * BEND} ${baseY}, ${fromX + dir * BEND} ${arrowY}, ${fromX + dir * BEND * 2} ${arrowY} L ${toX} ${arrowY}`}
							fill="none"
							stroke={color}
							strokeWidth={1.2}
							strokeDasharray="3,3"
							opacity={opacity}
							markerEnd={markerRef}
						/>
					);
				});
			})}

			{/* Action nodes */}
			{nodes.map((node) => {
				const pos = layout.nodePositions.get(node.id);
				if (!pos) return null;

				const color = getNodeColor(node.action_type);
				const icon = getNodeIcon(node.action_type);
				const label = getNodeLabel(node.action_type);
				const dimmed = hasHighlight && !highlightedNodeIds.has(node.id);
				const displayText = node.message ? `${icon} ${truncate(node.message, 22)}` : `${icon} ${label}`;

				return (
					<g
						key={node.id}
						opacity={dimmed ? 0.15 : 1}
						style={{ cursor: 'pointer' }}
						onMouseEnter={() => onHoverNode(node.id)}
						onMouseLeave={() => onHoverNode(null)}
						onClick={() => onClickNode(node.id)}
						onTouchStart={() => handleNodeTouchStart(node.id)}
						onTouchEnd={handleNodeTouchEnd}
					>
						{/* Small solid dot on the lane line */}
						<circle
							cx={pos.x}
							cy={pos.y}
							r={5}
							fill={color}
						/>
						{/* Row 1: timestamp */}
						<text x={pos.x + 12} y={pos.y - 8} fontSize="9" fill="var(--text-muted)">
							{formatTime(node.created_at)}
						</text>
						{/* Row 2: icon + message or default label */}
						<text x={pos.x + 12} y={pos.y + 7} fontSize="10" fontWeight="600" fill={color}>
							{displayText}
						</text>
					</g>
				);
			})}
		</svg>
	);
}
