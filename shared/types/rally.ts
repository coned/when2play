export type ActionType = 'call' | 'in' | 'out' | 'ping' | 'judge_time' | 'judge_avail' | 'brb' | 'where' | 'share_ranking';

/** creator_id is never sent to clients: it would reveal the caller of an anonymous first call. */
export interface Rally {
  id: string;
  timing: string;
  day_key: string;
  status: 'open' | 'closed';
  created_at: string;
}

/** Actor id the API reports for every anonymous action (metadata.is_anonymous). */
export const ANONYMOUS_ACTOR_ID = '__anonymous__';

/**
 * For an anonymous action (metadata.is_anonymous === true) the API replaces the
 * actor: actor_id is ANONYMOUS_ACTOR_ID, actor_username is 'Anonymous',
 * actor_avatar and actor_discord_id are null.
 */
export interface RallyAction {
  id: string;
  rally_id: string | null;
  actor_id: string;
  action_type: ActionType;
  target_user_ids: string[] | null;
  message: string | null;
  metadata: Record<string, unknown> | null;
  delivered: boolean;
  day_key: string;
  created_at: string;
}

export interface RallyTreeNode {
  id: string;
  action_type: ActionType;
  actor_id: string;
  actor_username: string;
  actor_avatar: string | null;
  target_user_ids: string[] | null;
  message: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  rally_id: string | null;
}

export interface RallyTreeData {
  nodes: RallyTreeNode[];
  edges: Array<{ source: string; target: string; type: 'response' | 'ping' | 'sequence' }>;
  rallies: Rally[];
  participants: Record<string, { username: string; avatar: string | null }>;
}

export interface JudgeTimeResult {
  windows: Array<{ start: string; end: string; user_count: number; user_ids: string[] }>;
  day_key: string;
}

export interface CreateRallyRequest {
  timing?: 'now' | 'later';
}

export interface CreateActionRequest {
  action_type: ActionType;
  rally_id?: string;
  target_user_ids?: string[];
  message?: string;
  is_anonymous?: boolean;
}

/**
 * Max length of ShareTreeRequest.image_data (base64 PNG, no data: prefix).
 * Keeps the row well under D1's 2 MB row limit; larger uploads get 413.
 */
export const TREE_SHARE_MAX_IMAGE_CHARS = 1_400_000;

export interface ShareTreeRequest {
  image_data: string;
}
