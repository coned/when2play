export interface Game {
	id: string;
	name: string;
	steam_app_id: string | null;
	image_url: string | null;
	proposed_by: string;
	is_archived: boolean;
	created_at: string;
	archived_at: string | null;
}

export interface CreateGameRequest {
	name: string;
	steam_app_id?: string;
	image_url?: string;
}

export interface UpdateGameRequest {
	name?: string;
	image_url?: string;
}

export interface GameVote {
	id: string;
	game_id: string;
	user_id: string;
	rank: number;
	is_approved: boolean;
	created_at: string;
}

export interface SetVoteRequest {
	rank: number;
	is_approved?: boolean;
}

export interface GameRanking {
	game: Game;
	total_score: number;
	vote_count: number;
	votes: GameVote[];
}

export interface SteamSearchResult {
	app_id: string;
	name: string;
	image_url: string;
}

export interface ReorderVotesRequest {
	rankings: Array<{ game_id: string; rank: number }>;
}
