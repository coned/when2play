import type { ActionType, RallyTreeNode } from '@when2play/shared';

// -- View mode --

export type ViewMode = 'sequence' | 'radial';

// -- Re-export for convenience --

export type TreeNode = RallyTreeNode;

export interface TreeEdge {
	source: string;
	target: string;
	type: 'response' | 'ping' | 'sequence';
}

export interface Participant {
	username: string;
	avatar: string | null;
}

// -- Action styling --

export const ACTION_COLORS: Record<string, string> = {
	call: '#4a9eff',
	in: '#4caf50',
	out: '#f44336',
	ping: '#ff9800',
	brb: '#ffc107',
	where: '#9c27b0',
	judge_time: '#26a69a',
	judge_avail: '#26a69a',
	share_ranking: '#f59e0b',
};

export const ACTION_ICONS: Record<string, string> = {
	call: '\u{1F4E2}',
	in: '\u2705',
	out: '\u274C',
	ping: '\u{1F44B}',
	brb: '\u23F3',
	where: '\u2753',
	judge_time: '\u{1F916}',
	judge_avail: '\u{1F916}',
	share_ranking: '\u{1F3C6}',
};

export const ACTION_LABELS: Record<string, string> = {
	call: 'called',
	in: 'is in',
	out: 'is out',
	ping: 'pinged',
	brb: 'brb',
	where: 'asked where',
	judge_time: 'judge: time',
	judge_avail: 'judge: avail',
	share_ranking: 'shared ranking',
};

// -- Layout constants --

export const LANE_WIDTH = 150;
export const ROW_HEIGHT = 60;
export const RING_SPACING = 140;
export const MARGIN = 40;

export const NODE_RADIUS_CENTER = 40;
export const NODE_RADIUS_RING1 = 30;
export const NODE_RADIUS_RING2 = 24;
export const NODE_RADIUS_DEFAULT = 20;

export const SEQUENCE_NODE_SIZE = 28;
export const LANE_HEADER_HEIGHT = 80;

// -- Anonymous sentinel --

export const ANONYMOUS_ID = '__anonymous__';

// -- Utilities --

export function formatTime(iso: string): string {
	const d = new Date(iso);
	return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

export function truncate(str: string, max: number): string {
	return str.length > max ? str.slice(0, max - 1) + '\u2026' : str;
}

export function isAnonymous(node: TreeNode): boolean {
	return !!(node.metadata?.is_anonymous);
}

export function getNodeColor(actionType: string): string {
	return ACTION_COLORS[actionType] ?? '#888';
}

export function getNodeIcon(actionType: string): string {
	return ACTION_ICONS[actionType] ?? '\u2022';
}

export function getNodeLabel(actionType: string): string {
	return ACTION_LABELS[actionType] ?? actionType;
}

export function getInitials(username: string): string {
	return username.slice(0, 2).toUpperCase();
}
