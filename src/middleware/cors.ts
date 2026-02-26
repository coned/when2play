import { cors as honoCors } from 'hono/cors';

export const cors = honoCors({
	origin: ['http://localhost:5173'],
	credentials: true,
});
