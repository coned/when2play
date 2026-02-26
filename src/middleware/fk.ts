import { createMiddleware } from 'hono/factory';
import type { Bindings } from '../env';

export const foreignKeys = createMiddleware<{ Bindings: Bindings }>(async (c, next) => {
	await c.env.DB.exec('PRAGMA foreign_keys = ON');
	await next();
});
