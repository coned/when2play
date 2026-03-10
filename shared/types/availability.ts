export type AvailabilityStatus = 'tentative' | 'confirmed' | 'manual';

export type SlotStatus = 'available' | 'tentative';

export interface AvailabilitySlot {
	id: string;
	user_id: string;
	date: string;
	start_time: string;
	end_time: string;
	created_at: string;
	status?: AvailabilityStatus;
	slot_status?: SlotStatus;
}

export interface SetAvailabilityRequest {
	date: string;
	slots: Array<{
		start_time: string;
		end_time: string;
		slot_status?: SlotStatus;
	}>;
}

export interface OverlapWindow {
	date: string;
	start_time: string;
	end_time: string;
	users: string[];
}

export type AvailabilityStatusInfo = {
	status: AvailabilityStatus | null;
	hasTentativeSlots?: boolean;
};

export type AvailabilityStatusMap = Record<string, AvailabilityStatusInfo>;
