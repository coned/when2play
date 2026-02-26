import { createMiddleware } from 'hono/factory';
import type { Bindings } from '../env';

export const securityHeaders = createMiddleware<{ Bindings: Bindings }>(async (c, next) => {
	await next();
	c.header('X-Content-Type-Options', 'nosniff');
	c.header('X-Frame-Options', 'DENY');
	c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
});
