export type AvailabilityStatus = 'tentative' | 'confirmed' | 'manual';

export interface AvailabilitySlot {
	id: string;
	user_id: string;
	date: string;
	start_time: string;
	end_time: string;
	created_at: string;
	status?: AvailabilityStatus;
}

export interface SetAvailabilityRequest {
	date: string;
	slots: Array<{
		start_time: string;
		end_time: string;
	}>;
}

export interface OverlapWindow {
	date: string;
	start_time: string;
	end_time: string;
	users: string[];
}

export type AvailabilityStatusMap = Record<string, AvailabilityStatus | null>;
