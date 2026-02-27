export type ActionType = 'call' | 'in' | 'out' | 'ping' | 'judge_time' | 'judge_avail' | 'brb' | 'where' | 'share_ranking';

export interface Rally {
  id: string;
  creator_id: string;
  timing: string;
  day_key: string;
  status: 'open' | 'closed';
  created_at: string;
}

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
}

export interface ShareTreeRequest {
  image_data: string;
}
