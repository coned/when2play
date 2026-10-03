// Turning Worker API responses into results a slash command can show.
// No side effects on import.

export const GENERIC_ERROR_REPLY = 'Something went wrong. Is the when2play server running?';
const MAX_USER_MESSAGE = 300;

/**
 * A failed Worker request. `userMessage` is the Worker's own error text when it is safe to show
 * (a 4xx with a JSON error body), otherwise null and the caller shows a generic reply.
 */
export class ApiError extends Error {
    constructor({ status = null, code = null, userMessage = null, detail = '' } = {}) {
        const parts = [status !== null ? `HTTP ${status}` : 'API', code, detail].filter(Boolean);
        super(parts.join(' '));
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
        this.userMessage = userMessage;
    }
}

function cleanMessage(message) {
    if (typeof message !== 'string') return null;
    const trimmed = message.trim();
    if (!trimmed) return null;
    return trimmed.length > MAX_USER_MESSAGE ? `${trimmed.slice(0, MAX_USER_MESSAGE - 3)}...` : trimmed;
}

/**
 * Read a fetch Response from the Worker.
 * Returns { ok: true, data } for a 2xx `{ ok: true }` body, otherwise { ok: false, error: ApiError }.
 * Only a 4xx (or a 2xx with ok=false) whose body is `{ ok: false, error: { message } }` carries a
 * user-facing message; 5xx, non-JSON bodies and unexpected shapes stay generic.
 */
export async function readApiResult(res) {
    const status = res.status;
    const text = await res.text().catch(() => '');
    let json = null;
    try {
        json = text ? JSON.parse(text) : null;
    } catch {
        json = null;
    }

    if (status >= 200 && status < 300 && json?.ok === true) {
        return { ok: true, data: json.data };
    }

    const code = typeof json?.error?.code === 'string' ? json.error.code : null;
    const apiMessage = cleanMessage(json?.error?.message);
    const showable = json?.ok === false && apiMessage !== null && status < 500;
    const detail = apiMessage ?? (json ? 'unexpected response body' : `non-JSON body: ${text.slice(0, 200)}`);
    return {
        ok: false,
        error: new ApiError({ status, code, userMessage: showable ? apiMessage : null, detail }),
    };
}

/** The reply text for an error thrown while handling a slash command. */
export function errorReply(err, fallback = GENERIC_ERROR_REPLY) {
    return err instanceof ApiError && err.userMessage ? err.userMessage : fallback;
}
