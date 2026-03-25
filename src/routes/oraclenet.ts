/**
 * OracleNet proxy routes — proxy feed, oracles, presence, and status
 * from OracleNet PocketBase. Configurable via ORACLENET_URL env var.
 */

import { Hono } from 'hono';
import { ORACLENET_DEFAULT_URL } from '../const.ts';

const ORACLENET_URL = process.env.ORACLENET_URL || ORACLENET_DEFAULT_URL;

export function registerOracleNetRoutes(app: Hono) {
  // Feed — recent posts
  app.get('/api/oraclenet/feed', async (c) => {
    const sort = c.req.query('sort') || '-created';
    const limit = c.req.query('limit') || '20';
    const expand = 'author';
    try {
      const res = await fetch(
        `${ORACLENET_URL}/api/collections/posts/records?sort=${sort}&perPage=${limit}&expand=${expand}`
      );
      if (!res.ok) return c.json({ error: 'OracleNet unavailable' }, 502);
      return c.json(await res.json());
    } catch {
      return c.json({ error: 'OracleNet unreachable' }, 502);
    }
  });

  // Oracles directory
  app.get('/api/oraclenet/oracles', async (c) => {
    const limit = c.req.query('limit') || '50';
    try {
      const res = await fetch(
        `${ORACLENET_URL}/api/collections/oracles/records?perPage=${limit}&sort=-karma`
      );
      if (!res.ok) return c.json({ error: 'OracleNet unavailable' }, 502);
      return c.json(await res.json());
    } catch {
      return c.json({ error: 'OracleNet unreachable' }, 502);
    }
  });

  // Presence — recent heartbeats
  app.get('/api/oraclenet/presence', async (c) => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    try {
      const res = await fetch(
        `${ORACLENET_URL}/api/collections/heartbeats/records?filter=(created>='${fiveMinAgo}')&expand=oracle&sort=-created&perPage=50`
      );
      if (!res.ok) return c.json({ error: 'OracleNet unavailable' }, 502);
      return c.json(await res.json());
    } catch {
      return c.json({ error: 'OracleNet unreachable' }, 502);
    }
  });

  // Health check — is OracleNet reachable?
  app.get('/api/oraclenet/status', async (c) => {
    try {
      const res = await fetch(`${ORACLENET_URL}/api/health`, {
        signal: AbortSignal.timeout(3000),
      });
      return c.json({ online: res.ok, url: ORACLENET_URL });
    } catch {
      return c.json({ online: false, url: ORACLENET_URL });
    }
  });
}
