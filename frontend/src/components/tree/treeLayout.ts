import type { TreeNode, TreeEdge, Participant } from './treeConstants';
import {
	LANE_WIDTH,
	ROW_HEIGHT,
	RING_SPACING,
	MARGIN,
	LANE_HEADER_HEIGHT,
	ANONYMOUS_ID,
	isAnonymous,
} from './treeConstants';

// ---------- Sequence layout ----------

export interface SequenceLane {
	id: string; // participant user ID or ANONYMOUS_ID or '__system__'
	label: string;
	avatar: string | null;
	x: number;
}

export interface SequenceNodePos {
	nodeId: string;
	laneId: string;
	x: number;
	y: number;
}

export interface SequenceArrow {
	edgeIndex: number;
	edge: TreeEdge;
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}

export interface SequenceLayout {
	lanes: SequenceLane[];
	nodePositions: Map<string, SequenceNodePos>;
	arrows: SequenceArrow[];
	sessionBannerY: number | null;
	width: number;
	height: number;
}

const SYSTEM_LANE_ID = '__system__';
const SYSTEM_ACTIONS = new Set(['judge_time', 'judge_avail', 'share_ranking']);

export function computeSequenceLayout(
	nodes: TreeNode[],
	edges: TreeEdge[],
	participants: Record<string, Participant>,
): SequenceLayout {
	if (nodes.length === 0) {
		return { lanes: [], nodePositions: new Map(), arrows: [], sessionBannerY: null, width: 0, height: 0 };
	}

	// Sort nodes by created_at
	const sorted = [...nodes].sort((a, b) => a.created_at.localeCompare(b.created_at));

	// Determine lane assignment for each node
	const laneOrder: string[] = [];
	const laneSet = new Set<string>();

	function ensureLane(id: string) {
		if (!laneSet.has(id)) {
			laneSet.add(id);
			laneOrder.push(id);
		}
	}

	for (const node of sorted) {
		if (SYSTEM_ACTIONS.has(node.action_type)) {
			ensureLane(SYSTEM_LANE_ID);
		} else if (isAnonymous(node)) {
			ensureLane(ANONYMOUS_ID);
		} else {
			ensureLane(node.actor_id);
		}
	}

	// Build lanes with positions
	const lanes: SequenceLane[] = laneOrder.map((id, i) => {
		let label: string;
		let avatar: string | null = null;
		if (id === SYSTEM_LANE_ID) {
			label = 'System';
		} else if (id === ANONYMOUS_ID) {
			label = 'Anonymous';
		} else {
			const p = participants[id];
			label = p?.username ?? 'Unknown';
			avatar = p?.avatar ?? null;
		}
		return { id, label, avatar, x: MARGIN + i * LANE_WIDTH + LANE_WIDTH / 2 };
	});

	const laneMap = new Map(lanes.map((l) => [l.id, l]));

	// Place nodes vertically
	const nodePositions = new Map<string, SequenceNodePos>();
	let sessionBannerY: number | null = null;

	for (let i = 0; i < sorted.length; i++) {
		const node = sorted[i];
		let laneId: string;
		if (SYSTEM_ACTIONS.has(node.action_type)) {
			laneId = SYSTEM_LANE_ID;
		} else if (isAnonymous(node)) {
			laneId = ANONYMOUS_ID;
		} else {
			laneId = node.actor_id;
		}

		const lane = laneMap.get(laneId)!;
		const y = MARGIN + LANE_HEADER_HEIGHT + i * ROW_HEIGHT + ROW_HEIGHT / 2;

		nodePositions.set(node.id, { nodeId: node.id, laneId, x: lane.x, y });

		// Detect session locked
		if (sessionBannerY === null && (node.action_type === 'judge_time' || node.action_type === 'judge_avail')) {
			sessionBannerY = y;
		}
	}

	// Build arrows from edges
	const arrows: SequenceArrow[] = [];
	for (let i = 0; i < edges.length; i++) {
		const edge = edges[i];
		const src = nodePositions.get(edge.source);
		const tgt = nodePositions.get(edge.target);
		if (!src || !tgt) continue;
		arrows.push({
			edgeIndex: i,
			edge,
			x1: src.x,
			y1: src.y,
			x2: tgt.x,
			y2: tgt.y,
		});
	}

	const width = lanes.length * LANE_WIDTH + MARGIN * 2;
	const height = MARGIN + LANE_HEADER_HEIGHT + sorted.length * ROW_HEIGHT + MARGIN;

	return { lanes, nodePositions, arrows, sessionBannerY, width, height };
}

// ---------- Radial layout ----------

export interface RadialNodePos {
	nodeId: string;
	x: number;
	y: number;
	ring: number;
	radius: number;
}

export interface RadialEdgePath {
	edgeIndex: number;
	edge: TreeEdge;
	path: string;
}

export interface RadialLayout {
	nodePositions: Map<string, RadialNodePos>;
	edgePaths: RadialEdgePath[];
	totalRadius: number;
	centerX: number;
	centerY: number;
	width: number;
	height: number;
}

// Minimum arc-distance between node centers on a ring (px).
// Nodes are ~50-70px wide (circle + label below), so 80 prevents overlap.
const MIN_ARC_GAP = 80;

// Semantic ring assignment: group by action_type instead of BFS distance.
// This avoids the problem where all nodes end up on ring 1 because every
// action has a direct edge from the call node.
const RING_BY_ACTION: Record<string, number> = {
	call: 0,
	in: 1,
	out: 1,
	brb: 1,
	ping: 2,
	where: 2,
	judge_time: 3,
	judge_avail: 3,
	share_ranking: 3,
};

export function computeRadialLayout(
	nodes: TreeNode[],
	edges: TreeEdge[],
): RadialLayout {
	if (nodes.length === 0) {
		return { nodePositions: new Map(), edgePaths: [], totalRadius: 0, centerX: 0, centerY: 0, width: 0, height: 0 };
	}

	// Assign rings by action type (semantic grouping)
	const ringAssignment = new Map<string, number>();
	for (const node of nodes) {
		ringAssignment.set(node.id, RING_BY_ACTION[node.action_type] ?? 2);
	}

	// Group nodes by ring, sort by created_at within each ring
	const ringGroups = new Map<number, TreeNode[]>();
	for (const node of nodes) {
		const ring = ringAssignment.get(node.id)!;
		if (!ringGroups.has(ring)) ringGroups.set(ring, []);
		ringGroups.get(ring)!.push(node);
	}
	for (const group of ringGroups.values()) {
		group.sort((a, b) => a.created_at.localeCompare(b.created_at));
	}

	const maxRing = Math.max(...Array.from(ringAssignment.values()));

	// Compute ring radii with dynamic expansion for crowded rings.
	// circumference = 2 * PI * r, arc gap = circumference / count
	// => r >= (count * MIN_ARC_GAP) / (2 * PI)
	const ringRadii = new Map<number, number>();
	let cumulativeRadius = 0;
	for (let ring = 0; ring <= maxRing; ring++) {
		if (ring === 0) {
			ringRadii.set(0, 0);
			continue;
		}
		// Skip empty rings (e.g., no ping/where actions means ring 2 is empty)
		const count = ringGroups.get(ring)?.length ?? 0;
		if (count === 0) {
			ringRadii.set(ring, cumulativeRadius + RING_SPACING * 0.5);
			continue;
		}
		const minRadiusForSpacing = count > 1 ? (count * MIN_ARC_GAP) / (2 * Math.PI) : 0;
		const baseRadius = cumulativeRadius + RING_SPACING;
		const actual = Math.max(baseRadius, minRadiusForSpacing);
		ringRadii.set(ring, actual);
		cumulativeRadius = actual;
	}

	const outerRadius = cumulativeRadius || RING_SPACING;
	const totalRadius = outerRadius + MARGIN;
	const centerX = totalRadius + MARGIN;
	const centerY = totalRadius + MARGIN;

	// Node radius by ring
	const nodeRadiusByRing = (ring: number): number => {
		if (ring === 0) return 32;
		if (ring === 1) return 24;
		if (ring === 2) return 20;
		return 18;
	};

	// Position nodes
	const nodePositions = new Map<string, RadialNodePos>();

	for (const [ring, group] of ringGroups) {
		if (ring === 0) {
			for (const node of group) {
				nodePositions.set(node.id, { nodeId: node.id, x: centerX, y: centerY, ring: 0, radius: nodeRadiusByRing(0) });
			}
		} else {
			const r = ringRadii.get(ring) ?? ring * RING_SPACING;
			const count = group.length;
			const nodeRadius = nodeRadiusByRing(ring);

			for (let i = 0; i < count; i++) {
				const angle = (2 * Math.PI * i) / count - Math.PI / 2; // start from top
				const x = centerX + r * Math.cos(angle);
				const y = centerY + r * Math.sin(angle);
				nodePositions.set(group[i].id, { nodeId: group[i].id, x, y, ring, radius: nodeRadius });
			}
		}
	}

	// Build edge paths as quadratic beziers
	const edgePaths: RadialEdgePath[] = [];
	for (let i = 0; i < edges.length; i++) {
		const edge = edges[i];
		const src = nodePositions.get(edge.source);
		const tgt = nodePositions.get(edge.target);
		if (!src || !tgt) continue;

		// Control point: offset perpendicular to the midpoint
		const mx = (src.x + tgt.x) / 2;
		const my = (src.y + tgt.y) / 2;
		const dx = tgt.x - src.x;
		const dy = tgt.y - src.y;
		const len = Math.sqrt(dx * dx + dy * dy) || 1;
		const perpX = -dy / len;
		const perpY = dx / len;
		const offset = Math.min(len * 0.15, 30);
		const cx = mx + perpX * offset;
		const cy = my + perpY * offset;

		edgePaths.push({
			edgeIndex: i,
			edge,
			path: `M ${src.x} ${src.y} Q ${cx} ${cy} ${tgt.x} ${tgt.y}`,
		});
	}

	const side = (totalRadius + MARGIN) * 2;
	return { nodePositions, edgePaths, totalRadius, centerX, centerY, width: side, height: side };
}

// ---------- Helpers ----------

export function findSessionLockedNode(nodes: TreeNode[]): TreeNode | undefined {
	return nodes.find((n) => n.action_type === 'judge_time' || n.action_type === 'judge_avail');
}

export function filterByUsers(
	nodes: TreeNode[],
	edges: TreeEdge[],
	filterSet: Set<string>,
): { nodes: TreeNode[]; edges: TreeEdge[] } {
	if (filterSet.size === 0) return { nodes, edges };

	const filtered = nodes.filter((n) => {
		if (isAnonymous(n)) return filterSet.has(ANONYMOUS_ID);
		return filterSet.has(n.actor_id);
	});

	const nodeIds = new Set(filtered.map((n) => n.id));
	const filteredEdges = edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));

	return { nodes: filtered, edges: filteredEdges };
}
