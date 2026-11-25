import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

const MTR_STATIONS_URL = 'https://map.murs-mc.ru/mtr/api/map/stations-and-routes';
const MTR_DEPARTURES_URL = 'https://map.murs-mc.ru/mtr/api/map/departures';
const BLUEMAP_SETTINGS_URL = 'https://bluemap.murs-mc.ru/maps/world/settings.json';

const DATA_DIR = path.resolve(__dirname, 'data');
const EDITS_FILE = path.join(DATA_DIR, 'murs-edits.json');

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

let stationsCache: CacheEntry<unknown> | null = null;
let departuresCache: CacheEntry<unknown> | null = null;
let bluemapCache: CacheEntry<unknown> | null = null;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readEditsFile() {
  ensureDataDir();
  const emptyPayload = {
    buildings: [],
    deletedBuildingIds: [],
    streets: [],
    deletedStreetIds: [],
    landFeatures: [],
    deletedLandIds: [],
    pois: [],
    deletedPoiIds: [],
    stationOverrides: {},
    routeOverrides: {},
    updatedAt: new Date().toISOString(),
  };
  if (!fs.existsSync(EDITS_FILE)) {
    return emptyPayload;
  }
  try {
    const raw = fs.readFileSync(EDITS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      ...emptyPayload,
      ...parsed,
      buildings: Array.isArray(parsed?.buildings) ? parsed.buildings : [],
      deletedBuildingIds: Array.isArray(parsed?.deletedBuildingIds) ? parsed.deletedBuildingIds : [],
      streets: Array.isArray(parsed?.streets) ? parsed.streets : [],
      deletedStreetIds: Array.isArray(parsed?.deletedStreetIds) ? parsed.deletedStreetIds : [],
      landFeatures: Array.isArray(parsed?.landFeatures) ? parsed.landFeatures : [],
      deletedLandIds: Array.isArray(parsed?.deletedLandIds) ? parsed.deletedLandIds : [],
      pois: Array.isArray(parsed?.pois) ? parsed.pois : [],
      deletedPoiIds: Array.isArray(parsed?.deletedPoiIds) ? parsed.deletedPoiIds : [],
      stationOverrides:
        parsed?.stationOverrides && typeof parsed.stationOverrides === 'object'
          ? parsed.stationOverrides
          : {},
      routeOverrides:
        parsed?.routeOverrides && typeof parsed.routeOverrides === 'object'
          ? parsed.routeOverrides
          : {},
    };
  } catch {
    return emptyPayload;
  }
}

async function fetchJsonWithTimeout(url: string, timeoutMs = 5500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'MURS-Maps-Navigator/1.0',
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function createServer() {
  const app = express();
  app.use(express.json({ limit: '64mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'murs-maps' });
  });

  app.get('/api/mtr/stations-and-routes', async (_req, res) => {
    const now = Date.now();
    if (stationsCache && now - stationsCache.fetchedAt < 60_000) {
      res.json({ source: 'live-cache', payload: stationsCache.data });
      return;
    }
    try {
      const data = await fetchJsonWithTimeout(MTR_STATIONS_URL, 6000);
      stationsCache = { data, fetchedAt: now };
      res.json({ source: 'live', payload: data });
    } catch (err) {
      if (stationsCache) {
        res.json({ source: 'stale-cache', payload: stationsCache.data });
        return;
      }
      res.status(200).json({
        source: 'fallback',
        error: err instanceof Error ? err.message : 'Upstream unavailable',
        payload: null,
      });
    }
  });

  app.get('/api/mtr/departures', async (_req, res) => {
    const now = Date.now();
    if (departuresCache && now - departuresCache.fetchedAt < 15_000) {
      res.json({ source: 'live-cache', payload: departuresCache.data });
      return;
    }
    try {
      const data = await fetchJsonWithTimeout(MTR_DEPARTURES_URL, 5000);
      departuresCache = { data, fetchedAt: now };
      res.json({ source: 'live', payload: data });
    } catch (err) {
      if (departuresCache) {
        res.json({ source: 'stale-cache', payload: departuresCache.data });
        return;
      }
      res.status(200).json({
        source: 'fallback',
        error: err instanceof Error ? err.message : 'Upstream unavailable',
        payload: null,
      });
    }
  });

  app.get('/api/bluemap/settings', async (_req, res) => {
    const now = Date.now();
    if (bluemapCache && now - bluemapCache.fetchedAt < 300_000) {
      res.json({ source: 'live-cache', payload: bluemapCache.data });
      return;
    }
    try {
      const data = await fetchJsonWithTimeout(BLUEMAP_SETTINGS_URL, 5000);
      bluemapCache = { data, fetchedAt: now };
      res.json({ source: 'live', payload: data });
    } catch {
      res.json({
        source: 'fallback',
        payload: { name: 'world (overworld)', startPos: [9215, -1] },
      });
    }
  });

  const tileCache = new Map<string, { buf: Buffer; fetchedAt: number }>();

  const serveBlueMapTile = async (
    lod: number,
    tx: number,
    tz: number,
    res: express.Response
  ) => {
    if (
      ![1, 2, 3].includes(lod) ||
      !Number.isFinite(tx) ||
      !Number.isFinite(tz) ||
      Math.abs(tx) > 500 ||
      Math.abs(tz) > 500
    ) {
      res.status(400).json({ error: 'Invalid tile coordinates or LOD' });
      return;
    }

    const key = `lod${lod}_${tx}_${tz}`;
    const cached = tileCache.get(key);
    if (cached && Date.now() - cached.fetchedAt < 600_000) {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(cached.buf);
      return;
    }

    const tileUrl = `https://bluemap.murs-mc.ru/maps/world/tiles/${lod}/x${tx}/z${tz}.png`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    try {
      const upstream = await fetch(tileUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': 'MURS-Maps-Navigator/1.0' },
      });
      if (!upstream.ok) {
        res.status(404).json({ error: 'Tile not found' });
        return;
      }
      const buf = Buffer.from(await upstream.arrayBuffer());
      if (tileCache.size > 180) {
        const firstKey = tileCache.keys().next().value;
        if (firstKey) tileCache.delete(firstKey);
      }
      tileCache.set(key, { buf, fetchedAt: Date.now() });
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(buf);
    } catch {
      res.status(502).json({ error: 'Upstream BlueMap tile unavailable' });
    } finally {
      clearTimeout(timer);
    }
  };

  app.get('/api/bluemap/tile/:tx/:tz', async (req, res) => {
    const tx = Number.parseInt(req.params.tx, 10);
    const tz = Number.parseInt(req.params.tz, 10);
    await serveBlueMapTile(1, tx, tz, res);
  });

  app.get('/api/bluemap/tile/:lod/:tx/:tz', async (req, res) => {
    const lod = Number.parseInt(req.params.lod, 10);
    const tx = Number.parseInt(req.params.tx, 10);
    const tz = Number.parseInt(req.params.tz, 10);
    await serveBlueMapTile(lod, tx, tz, res);
  });

  // MAGIC API (MTR Addon for General Improvement and Customisation / JME) 3D Rail & Route Tracks proxy
  let magicTracksCache: CacheEntry<unknown> | null = null;

  const isAllowedMagicUrl = (rawUrl: string): boolean => {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
      const host = parsed.hostname.toLowerCase();
      return host === 'map.murs-mc.ru' || host.endsWith('.murs-mc.ru');
    } catch {
      return false;
    }
  };

  app.get('/api/magic/tracks', async (req, res) => {
    const forceRefresh = req.query.refresh === '1';
    const rawCustomUrl = typeof req.query.url === 'string' ? req.query.url.trim() : '';
    const now = Date.now();
    if (!forceRefresh && !rawCustomUrl && magicTracksCache && now - magicTracksCache.fetchedAt < 60_000) {
      res.json({ source: 'magic-cache', payload: magicTracksCache.data });
      return;
    }

    // Real MAGIC API endpoints matching https://map.murs-mc.ru/livemap (HTTP port 8088 first!)
    const customCandidates: string[] = [];
    const customEnvBase = process.env.MAGIC_API_URL?.trim().replace(/\/$/, '');
    for (const base of [rawCustomUrl.replace(/\/$/, ''), customEnvBase]) {
      if (base && isAllowedMagicUrl(base)) {
        customCandidates.push(
          base.includes('/api/') ? base : `${base}/api/rails?dimension=0`,
          `${base}/livemap/api/rails?dimension=0`
        );
      }
    }

    const railCandidates = [
      ...customCandidates,
      'http://map.murs-mc.ru:8088/api/rails?dimension=0',
      'https://map.murs-mc.ru:8088/api/rails?dimension=0',
      'http://map.murs-mc.ru:8088/livemap/api/rails?dimension=0',
      'https://map.murs-mc.ru:8088/livemap/api/rails?dimension=0',
      'http://map.murs-mc.ru:8888/mtr/api/map/rails?dimension=0',
      'https://map.murs-mc.ru/mtr/api/map/rails?dimension=0',
      'https://map.murs-mc.ru/mtr/api/map/jme-rails?dimension=0',
    ].filter((u, idx, arr) => isAllowedMagicUrl(u) && arr.indexOf(u) === idx);

    let railsData: Record<string, unknown> | null = null;
    let railsEndpoint: string | null = null;

    // Probe all allowlisted MAGIC endpoints concurrently so unreachable ports never block live ones
    const probeCandidate = async (url: string) => {
      const json = (await fetchJsonWithTimeout(url, 6500)) as {
        data?: Record<string, unknown>;
        rails?: unknown[];
        tracks?: unknown[];
      };
      if (!json || typeof json !== 'object') {
        throw new Error('Non-object MAGIC payload');
      }
      const inner = (json.data && typeof json.data === 'object' ? json.data : json) as Record<
        string,
        unknown
      >;
      const list = Array.isArray(inner.rails)
        ? inner.rails
        : Array.isArray(inner.tracks)
        ? inner.tracks
        : [];
      if (list.length === 0) {
        throw new Error('Empty rails array');
      }
      return { inner: { ...inner, rails: list }, url };
    };

    try {
      const firstHit = await Promise.any(railCandidates.map(probeCandidate));
      railsData = firstHit.inner;
      railsEndpoint = firstHit.url;
    } catch {
      railsData = null;
      railsEndpoint = null;
    }

    // Always fetch JME/MAGIC config for track speed/color metadata
    let jmeConfig: unknown = null;
    try {
      const cfg = (await fetchJsonWithTimeout(
        'https://map.murs-mc.ru/mtr/api/map/jme-config?dimension=0',
        4000
      )) as { data?: { config?: unknown } };
      jmeConfig = cfg?.data?.config ?? null;
    } catch {
      // optional
    }

    if (railsData) {
      const payload = {
        mode: 'magic-rails-live',
        endpoint: railsEndpoint,
        rails: railsData.rails,
        vehicles: Array.isArray(railsData.vehicles) ? railsData.vehicles : [],
        jmeConfig,
      };
      magicTracksCache = { data: payload, fetchedAt: now };
      res.json({ source: 'magic-rails-live', payload });
      return;
    }

    // Fallback: MURS JME/MTR stations-and-routes (contains exact 3D platform X/Y/Z and jmeType)
    try {
      const sr = (await fetchJsonWithTimeout(`${MTR_STATIONS_URL}?dimension=0`, 5500)) as {
        data?: Record<string, unknown>;
      };
      const payload = {
        mode: 'magic-jme-3d',
        endpoint: 'http://map.murs-mc.ru:8088/api/rails?dimension=0',
        diagnostic: 'Порт 8088 сервера MURS недоступен извне (таймаут) — активна привязка к дорогам и ручной импорт JSON',
        rails: [],
        vehicles: [],
        jmeConfig,
        data: sr?.data ?? null,
      };
      magicTracksCache = { data: payload, fetchedAt: now };
      res.json({ source: 'magic-jme-3d', payload });
      return;
    } catch {
      res.json({
        source: 'magic-fallback',
        payload: {
          mode: 'magic-fallback',
          endpoint: 'https://map.murs-mc.ru:8088/livemap',
          rails: [],
          vehicles: [],
          jmeConfig,
          data: null,
        },
      });
    }
  });

  app.get('/api/edits', (_req, res) => {
    res.json(readEditsFile());
  });

  app.post('/api/edits', async (req, res) => {
    try {
      const body = req.body;
      if (!body || typeof body !== 'object') {
        res.status(400).json({ error: 'Invalid edits payload' });
        return;
      }
      ensureDataDir();
      const payload = {
        buildings: Array.isArray(body.buildings) ? body.buildings : [],
        deletedBuildingIds: Array.isArray(body.deletedBuildingIds) ? body.deletedBuildingIds : [],
        streets: Array.isArray(body.streets) ? body.streets : [],
        deletedStreetIds: Array.isArray(body.deletedStreetIds) ? body.deletedStreetIds : [],
        landFeatures: Array.isArray(body.landFeatures) ? body.landFeatures : [],
        deletedLandIds: Array.isArray(body.deletedLandIds) ? body.deletedLandIds : [],
        pois: Array.isArray(body.pois) ? body.pois : [],
        deletedPoiIds: Array.isArray(body.deletedPoiIds) ? body.deletedPoiIds : [],
        stationOverrides:
          body.stationOverrides && typeof body.stationOverrides === 'object'
            ? body.stationOverrides
            : {},
        routeOverrides:
          body.routeOverrides && typeof body.routeOverrides === 'object'
            ? body.routeOverrides
            : {},
        updatedAt: new Date().toISOString(),
      };
      await fs.promises.writeFile(EDITS_FILE, JSON.stringify(payload), 'utf-8');
      res.json({ ok: true, updatedAt: payload.updatedAt });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to save edits',
      });
    }
  });

  const httpServer = http.createServer(app);

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        ws: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`MURMaps server listening on http://localhost:${PORT}`);
  });
}

createServer().catch((err) => {
  console.error('Failed to start MURMaps server:', err);
  process.exit(1);
});
