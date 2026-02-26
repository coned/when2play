export interface GatherPing {
	id: string;
	user_id: string;
	message: string | null;
	delivered: boolean;
	is_anonymous: boolean;
	target_user_ids: string[] | null;
	created_at: string;
}

export interface CreateGatherRequest {
	message?: string;
	is_anonymous?: boolean;
	target_user_ids?: string[];
}
