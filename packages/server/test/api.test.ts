import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';

import { createApp } from '../src/app.js';

describe('api', () => {
  let app: FastifyInstance;

  before(async () => {
    app = await createApp({ logger: false });
  });

  after(async () => {
    await app.close();
  });

  it('reports health', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().ok, true);
  });

  it('serves the catalog with images, editions and privacy tweaks', async () => {
    const body = (await app.inject({ method: 'GET', url: '/api/catalog' })).json();
    assert.ok(body.images.length >= 3);
    assert.ok(body.editions.some((e: { id: string }) => e.id === 'pro'));
    assert.ok(body.privacyTweaks.some((t: { id: string }) => t.id === 'telemetry'));
    assert.equal(body.defaults.easy.mode, 'easy');
  });

  it('builds a plan from a minimal configuration', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/windows/plan',
      payload: { account: { username: 'brian' } },
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.valid, true);
    assert.ok(body.plan.injectedFiles.some((f: { path: string }) => f.path === 'autounattend.xml'));
    assert.ok(body.plan.summary.length > 0);
  });

  it('reports validation errors instead of building a plan', async () => {
    const body = (
      await app.inject({ method: 'POST', url: '/api/windows/plan', payload: { account: { username: 'Administrator' } } })
    ).json();
    assert.equal(body.valid, false);
    assert.equal(body.plan, null);
    assert.ok(body.issues.some((i: { severity: string }) => i.severity === 'error'));
  });

  it('ignores unknown and hostile fields in the posted configuration', async () => {
    const body = (
      await app.inject({
        method: 'POST',
        url: '/api/windows/plan',
        payload: {
          account: { username: 'brian', administrator: 'yes-please' },
          privacy: ['telemetry', 'not-a-real-tweak'],
          debloat: { packages: ['Microsoft.BingNews', 'evil & rm -rf /'] },
          extraSetupCommands: ['echo hi', 'multi\nline'],
          somethingElse: { nested: true },
        },
      })
    ).json();
    assert.equal(body.valid, true);
    assert.deepEqual(body.config.privacy, ['telemetry']);
    assert.deepEqual(body.config.debloat.packages, ['Microsoft.BingNews']);
    assert.deepEqual(body.config.extraSetupCommands, ['echo hi']);
    // A non-boolean must fall back to the default rather than being coerced.
    assert.equal(body.config.account.administrator, true);
  });

  it('rejects a body that is not an object', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/windows/plan', payload: '"just a string"', headers: { 'content-type': 'application/json' } });
    assert.equal(response.json().valid, false);
  });

  it('returns 404 json for unknown api routes', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/nope' });
    assert.equal(response.statusCode, 404);
  });
});
