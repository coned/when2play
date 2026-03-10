import { useState, useMemo, useCallback } from 'preact/hooks';
import type { TreeNode, TreeEdge, Participant, ViewMode } from './treeConstants';
import { ANONYMOUS_ID, isAnonymous } from './treeConstants';
import { filterByUsers } from './treeLayout';

export interface TreeInteraction {
	viewMode: ViewMode;
	setViewMode: (mode: ViewMode) => void;

	hoveredNodeId: string | null;
	setHoveredNodeId: (id: string | null) => void;

	selectedNodeId: string | null;
	setSelectedNodeId: (id: string | null) => void;

	filterUserIds: Set<string>;
	toggleFilterUser: (userId: string) => void;
	clearFilters: () => void;

	highlightedNodeIds: Set<string>;
	highlightedEdgeIds: Set<number>;

	processedNodes: TreeNode[];
	processedEdges: TreeEdge[];

	// All unique participant IDs present in the data (for filter bar)
	participantIds: string[];
}

export function useTreeInteraction(
	nodes: TreeNode[],
	edges: TreeEdge[],
	participants: Record<string, Participant>,
): TreeInteraction {
	const [viewMode, setViewMode] = useState<ViewMode>(() => {
		try {
			const stored = localStorage.getItem('w2p_tree_view');
			if (stored === 'sequence' || stored === 'radial') return stored;
		} catch {}
		return 'sequence';
	});

	const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
	const [filterUserIds, setFilterUserIds] = useState<Set<string>>(new Set());

	const handleSetViewMode = useCallback((mode: ViewMode) => {
		setViewMode(mode);
		try { localStorage.setItem('w2p_tree_view', mode); } catch {}
	}, []);

	const toggleFilterUser = useCallback((userId: string) => {
		setFilterUserIds((prev) => {
			const next = new Set(prev);
			if (next.has(userId)) next.delete(userId);
			else next.add(userId);
			return next;
		});
	}, []);

	const clearFilters = useCallback(() => setFilterUserIds(new Set()), []);

	// Consolidate anonymous nodes depending on view mode
	const consolidatedData = useMemo(() => {
		if (viewMode === 'sequence') {
			// Sequence mode: keep individual nodes, remap actor_id to ANONYMOUS_ID
			const remapped = nodes.map((n) => {
				if (isAnonymous(n)) {
					return { ...n, actor_id: ANONYMOUS_ID, actor_username: 'Anonymous' };
				}
				return n;
			});
			return { nodes: remapped, edges };
		}

		// Radial mode: collapse all anonymous nodes into one synthetic node
		const anonNodes = nodes.filter(isAnonymous);
		const nonAnonNodes = nodes.filter((n) => !isAnonymous(n));

		if (anonNodes.length === 0) return { nodes, edges };

		const syntheticAnon: TreeNode = {
			id: ANONYMOUS_ID,
			action_type: anonNodes[0].action_type,
			actor_id: ANONYMOUS_ID,
			actor_username: `Anonymous x${anonNodes.length}`,
			actor_avatar: null,
			target_user_ids: null,
			message: null,
			metadata: { is_anonymous: true, count: anonNodes.length },
			created_at: anonNodes[0].created_at,
			rally_id: anonNodes[0].rally_id,
		};

		const anonIdSet = new Set(anonNodes.map((n) => n.id));
		const remappedEdges = edges
			.map((e) => ({
				source: anonIdSet.has(e.source) ? ANONYMOUS_ID : e.source,
				target: anonIdSet.has(e.target) ? ANONYMOUS_ID : e.target,
				type: e.type,
			}))
			// Deduplicate edges pointing to/from synthetic node
			.filter((e, i, arr) => {
				if (e.source === ANONYMOUS_ID || e.target === ANONYMOUS_ID) {
					return arr.findIndex((x) => x.source === e.source && x.target === e.target && x.type === e.type) === i;
				}
				return true;
			})
			// Remove self-loops
			.filter((e) => e.source !== e.target);

		return { nodes: [...nonAnonNodes, syntheticAnon], edges: remappedEdges };
	}, [nodes, edges, viewMode]);

	// Apply user filters
	const { nodes: processedNodes, edges: processedEdges } = useMemo(
		() => filterByUsers(consolidatedData.nodes, consolidatedData.edges, filterUserIds),
		[consolidatedData, filterUserIds],
	);

	// Compute participant IDs for filter bar
	const participantIds = useMemo(() => {
		const ids: string[] = [];
		const seen = new Set<string>();
		for (const node of consolidatedData.nodes) {
			const pid = isAnonymous(node) ? ANONYMOUS_ID : node.actor_id;
			if (!seen.has(pid)) {
				seen.add(pid);
				ids.push(pid);
			}
		}
		return ids;
	}, [consolidatedData.nodes]);

	// Highlight connected nodes/edges on hover
	const { highlightedNodeIds, highlightedEdgeIds } = useMemo(() => {
		const nodeIds = new Set<string>();
		const edgeIds = new Set<number>();

		if (!hoveredNodeId) return { highlightedNodeIds: nodeIds, highlightedEdgeIds: edgeIds };

		nodeIds.add(hoveredNodeId);

		for (let i = 0; i < processedEdges.length; i++) {
			const e = processedEdges[i];
			if (e.source === hoveredNodeId || e.target === hoveredNodeId) {
				edgeIds.add(i);
				nodeIds.add(e.source);
				nodeIds.add(e.target);
			}
		}

		return { highlightedNodeIds: nodeIds, highlightedEdgeIds: edgeIds };
	}, [hoveredNodeId, processedEdges]);

	return {
		viewMode,
		setViewMode: handleSetViewMode,
		hoveredNodeId,
		setHoveredNodeId,
		selectedNodeId,
		setSelectedNodeId,
		filterUserIds,
		toggleFilterUser,
		clearFilters,
		highlightedNodeIds,
		highlightedEdgeIds,
		processedNodes,
		processedEdges,
		participantIds,
	};
}
