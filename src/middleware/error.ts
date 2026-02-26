import { createMiddleware } from 'hono/factory';
import type { Bindings } from '../env';

export const errorHandler = createMiddleware<{ Bindings: Bindings }>(async (c, next) => {
	try {
		await next();
	} catch (err) {
		console.error('Unhandled error:', err);
		const isProduction = new URL(c.req.url).protocol === 'https:';
		const message = isProduction
			? 'Internal server error'
			: err instanceof Error
				? err.message
				: 'Internal server error';
		return c.json({ ok: false, error: { code: 'INTERNAL_ERROR', message } }, 500);
	}
});
