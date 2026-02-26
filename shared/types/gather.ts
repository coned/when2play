export interface GatherPing {
	id: string;
	user_id: string;
	message: string | null;
	delivered: boolean;
	created_at: string;
}

export interface CreateGatherRequest {
	message?: string;
}
