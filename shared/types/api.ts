export interface ApiResponse<T> {
	ok: true;
	data: T;
}

export interface ApiError {
	ok: false;
	error: {
		code: string;
		message: string;
	};
}

export type ApiResult<T> = ApiResponse<T> | ApiError;
