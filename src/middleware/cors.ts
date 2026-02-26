import { cors as honoCors } from 'hono/cors';
import { createMiddleware } from 'hono/factory';
import type { Bindings } from '../env';

const devOrigins = ['http://localhost:5173', 'http://localhost:8787'];

export const cors = createMiddleware<{ Bindings: Bindings }>(async (c, next) => {
	const isProduction = new URL(c.req.url).protocol === 'https:';
	const origin = isProduction
		? new URL(c.req.url).origin
		: devOrigins;

	const handler = honoCors({ origin, credentials: true });
	return handler(c, next);
});
