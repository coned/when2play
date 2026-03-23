import { createMiddleware } from 'hono/factory';
import type { Bindings } from '../env';

export const foreignKeys = createMiddleware<{ Bindings: Bindings }>(async (c, next) => {
	try {
		await c.env.DB.exec('PRAGMA foreign_keys = ON');
	} catch {
		// D1 cold-start can timeout on first touch; retry once
		await c.env.DB.exec('PRAGMA foreign_keys = ON');
	}
	await next();
});
