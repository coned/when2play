import { describe, it, expect } from 'vitest';
import app from '../src/index';

describe('Health endpoint', () => {
	it('returns healthy status', async () => {
		const response = await app.request('/api/health');
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body).toMatchObject({
			ok: true,
			data: { status: 'healthy' },
		});
		expect(body.data.timestamp).toBeDefined();
	});
});
