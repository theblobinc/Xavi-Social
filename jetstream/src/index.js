/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const WebSocket = require('ws');

function env(name, fallback = '') {
  const v = process.env[name];
  return v === undefined || v === null || v === '' ? fallback : String(v);
}

function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) ? n : fallback;
}

function splitCsv(raw) {
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildJetstreamUrl(base, wantedCollections, wantedDids, cursor) {
  const u = new URL(base);
  for (const c of wantedCollections) u.searchParams.append('wantedCollections', c);
  for (const did of wantedDids) u.searchParams.append('wantedDids', did);
  if (cursor) u.searchParams.set('cursor', String(cursor));
  // NOTE: we intentionally do NOT enable zstd compression (compress=true) to avoid needing the dictionary.
  return u.toString();
}

function atUri(did, collection, rkey) {
  return `at://${did}/${collection}/${rkey}`;
}

function safeJson(obj) {
  try {
    return JSON.stringify(obj);
  } catch {
    return '{}';
  }
}

function stripNulls(s) {
  return String(s || '').replace(/\u0000/g, '');
}

function ensureDirForFile(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadCursor(filePath) {
  try {
    if (!filePath) return null;
    if (!fs.existsSync(filePath)) return null;
    const s = fs.readFileSync(filePath, 'utf8').trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function saveCursor(filePath, cursor) {
  try {
    if (!filePath) return;
    ensureDirForFile(filePath);
    fs.writeFileSync(filePath, String(cursor) + '\n', 'utf8');
  } catch (e) {
    console.warn('WARN: failed to write cursor file:', e && e.message ? e.message : e);
  }
}

async function main() {
  const jetstreamBase = env('JETSTREAM_URL', 'wss://jetstream2.us-west.bsky.network/subscribe');
  const wantedCollections = splitCsv(env('WANTED_COLLECTIONS', 'app.bsky.feed.post'));
  const wantedDids = splitCsv(env('WANTED_DIDS', ''));

  const cursorFile = env('CURSOR_FILE', '/data/jetstream.cursor');
  const cursorRewindUs = envInt('CURSOR_REWIND_US', 2_000_000); // rewind 2s on reconnect

  const pgHost = env('XAVI_SOCIAL_PG_HOST', env('PGHOST', 'postgres'));
  const pgPort = envInt('XAVI_SOCIAL_PG_PORT', envInt('PGPORT', 5432));
  const pgDb = env('XAVI_SOCIAL_PG_DB', env('PGDATABASE', 'xavi_social'));
  const pgUser = env('XAVI_SOCIAL_PG_USER', env('PGUSER', 'xavi_social'));
  const pgPass = env('XAVI_SOCIAL_PG_PASSWORD', env('PGPASSWORD', env('PG_PASSWORD', '')));

  if (!pgPass) {
    throw new Error('Missing Postgres password: set XAVI_SOCIAL_PG_PASSWORD or PG_PASSWORD');
  }

  const client = new Client({
    host: pgHost,
    port: pgPort,
    database: pgDb,
    user: pgUser,
    password: pgPass,
  });

  await client.connect();

  // Ensure schema exists (minimal: the cached_posts table + indexes).
  await client.query(
    "CREATE TABLE IF NOT EXISTS xavi_social_cached_posts (\n" +
      "  id bigserial PRIMARY KEY,\n" +
      "  owner_user_id integer NOT NULL DEFAULT 0,\n" +
      "  source_account_id integer NOT NULL DEFAULT 0,\n" +
      "  origin text NOT NULL DEFAULT 'atproto',\n" +
      "  uri text NOT NULL UNIQUE,\n" +
      "  cid text NULL,\n" +
      "  author_did text NULL,\n" +
      "  author_handle text NULL,\n" +
      "  text text NULL,\n" +
      "  created_at_iso text NULL,\n" +
      "  indexed_at_iso text NULL,\n" +
      "  audience text NOT NULL DEFAULT 'public',\n" +
      "  requires_auth_to_interact boolean NOT NULL DEFAULT false,\n" +
      "  raw jsonb NULL,\n" +
      "  created_at timestamptz NOT NULL DEFAULT now(),\n" +
      "  updated_at timestamptz NOT NULL DEFAULT now()\n" +
      ");"
  );
  await client.query(
    "CREATE INDEX IF NOT EXISTS xavi_social_cached_posts_audience_updated_uri_idx ON xavi_social_cached_posts(audience, updated_at DESC, uri DESC);"
  );

  const upsertSql =
    "INSERT INTO xavi_social_cached_posts (\n" +
    "  owner_user_id, source_account_id, origin, uri, cid, author_did, author_handle, text, created_at_iso, indexed_at_iso, audience, requires_auth_to_interact, raw, updated_at\n" +
    ") VALUES (\n" +
    "  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, now()\n" +
    ") ON CONFLICT (uri) DO UPDATE SET\n" +
    "  origin = EXCLUDED.origin,\n" +
    "  cid = EXCLUDED.cid,\n" +
    "  author_did = EXCLUDED.author_did,\n" +
    "  author_handle = EXCLUDED.author_handle,\n" +
    "  text = EXCLUDED.text,\n" +
    "  created_at_iso = EXCLUDED.created_at_iso,\n" +
    "  indexed_at_iso = EXCLUDED.indexed_at_iso,\n" +
    "  audience = EXCLUDED.audience,\n" +
    "  requires_auth_to_interact = EXCLUDED.requires_auth_to_interact,\n" +
    "  raw = EXCLUDED.raw,\n" +
    "  updated_at = now()";

  const didToHandle = new Map();

  let lastCursor = loadCursor(cursorFile);
  if (lastCursor !== null) {
    lastCursor = Math.max(0, lastCursor - cursorRewindUs);
  }

  let backoffMs = 500;
  const maxBackoffMs = 15_000;

  console.log('Jetstream ingester starting');
  console.log('JETSTREAM_URL:', jetstreamBase);
  console.log('wantedCollections:', wantedCollections.join(','));
  console.log('wantedDids:', wantedDids.length ? wantedDids.join(',') : '(all)');
  console.log('cursorFile:', cursorFile);
  console.log('startingCursor:', lastCursor === null ? '(live)' : String(lastCursor));
  console.log('pg:', `${pgHost}:${pgPort}/${pgDb}`);

  async function connectLoop() {
    for (;;) {
      const url = buildJetstreamUrl(jetstreamBase, wantedCollections, wantedDids, lastCursor || null);
      console.log('Connecting:', url);

      const ws = new WebSocket(url, {
        perMessageDeflate: false,
      });

      const closePromise = new Promise((resolve) => {
        ws.on('close', () => resolve('close'));
        ws.on('error', () => resolve('error'));
      });

      ws.on('open', () => {
        backoffMs = 500;
        console.log('Connected');
      });

      ws.on('message', async (data) => {
        let msg;
        try {
          msg = JSON.parse(String(data));
        } catch {
          return;
        }

        if (!msg || typeof msg !== 'object') return;

        if (msg.kind === 'identity' && msg.identity && msg.identity.did && msg.identity.handle) {
          didToHandle.set(String(msg.identity.did), String(msg.identity.handle));
        }

        const timeUs = msg.time_us;
        if (typeof timeUs === 'number' && Number.isFinite(timeUs)) {
          lastCursor = timeUs;
        }

        if (msg.kind !== 'commit' || !msg.commit) {
          if (lastCursor) saveCursor(cursorFile, lastCursor);
          return;
        }

        const commit = msg.commit;
        const op = String(commit.operation || '');
        const collection = String(commit.collection || '');
        const rkey = String(commit.rkey || '');

        if ((op !== 'create' && op !== 'update') || collection !== 'app.bsky.feed.post' || !rkey) {
          if (lastCursor) saveCursor(cursorFile, lastCursor);
          return;
        }

        const did = String(msg.did || '');
        if (!did) return;

        const record = commit.record && typeof commit.record === 'object' ? commit.record : {};
        const text = stripNulls(typeof record.text === 'string' ? record.text : '');
        const createdAtIso = stripNulls(typeof record.createdAt === 'string' ? record.createdAt : '');

        const uri = stripNulls(atUri(did, collection, rkey));
        const cid = stripNulls(typeof commit.cid === 'string' ? commit.cid : '');
        const handle = stripNulls(didToHandle.get(did) || '');

        const raw = {
          uri,
          cid,
          text,
          createdAt: createdAtIso,
          indexedAt: createdAtIso,
          audience: 'public',
          author: {
            did,
            handle,
            displayName: '',
            avatar: '',
          },
          _jetstream: msg,
        };

        try {
          await client.query(upsertSql, [
            0,
            0,
            'jetstream',
            uri,
            cid,
            stripNulls(did),
            handle,
            text,
            createdAtIso,
            createdAtIso,
            'public',
            false,
            stripNulls(safeJson(raw)),
          ]);
        } catch (e) {
          console.warn('WARN: upsert failed:', e && e.message ? e.message : e);
        }

        if (lastCursor) saveCursor(cursorFile, lastCursor);
      });

      await closePromise;

      console.warn('Disconnected; retrying in', backoffMs, 'ms');
      await new Promise((r) => setTimeout(r, backoffMs));
      backoffMs = Math.min(maxBackoffMs, Math.floor(backoffMs * 1.7));

      if (lastCursor !== null) {
        lastCursor = Math.max(0, lastCursor - cursorRewindUs);
      }
    }
  }

  await connectLoop();
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
