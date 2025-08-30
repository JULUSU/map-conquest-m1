// server/index.js
const express = require('express');
const path = require('path');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const db = require('./db');
const { PORT, INIT_ON_BOOT } = require('./config');
const { initWorld, ensureSchema } = require('./initWorld');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, '..', 'public')));

// 健康检查
app.get('/healthz', (_req, res) => res.send('ok'));

// 探针：用来验证新代码是否真的部署成功
app.get('/debug/ping', (_req, res) => res.json({ ok: true, ts: Date.now(), version: 'ping-v1' }));

/** 世界状态（含 meta，避免空表时 -Infinity） */
app.get('/api/state', async (_req, res) => {
  try {
    const { rows: tiles } = await db.query(
      'SELECT id,x,y,terrain,resource,owner_faction_id,population,capture FROM tiles ORDER BY id'
    );
    const { rows: factions } = await db.query(
      'SELECT id,name,color,flag_url,capital_tile_id FROM factions ORDER BY id'
    );
    const { rows: metaRows } = await db.query(
      'SELECT COALESCE(MAX(x),-1)+1 AS w, COALESCE(MAX(y),-1)+1 AS h, COUNT(*)::int AS n FROM tiles'
    );
    res.json({ tiles, factions, meta: metaRows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'state_failed' });
  }
});

/** 阵营列表 */
app.get('/api/factions', async (_req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id,name,color,flag_url,capital_tile_id FROM factions ORDER BY id'
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'factions_failed' });
  }
});

/** 创建阵营（需选择未占领且非海洋的地块） */
app.post('/api/faction', async (req, res) => {
  const { name, color, flag_url, tile_id } = req.body || {};
  if (!name || !color || !tile_id) return res.status(400).json({ error: 'missing_fields' });

  try {
    await ensureSchema();

    const { rows: trows } = await db.query(
      'SELECT id, owner_faction_id, terrain FROM tiles WHERE id=$1',
      [tile_id]
    );
    if (!trows.length) return res.status(404).json({ error: 'tile_not_found' });
    if (trows[0].terrain === 7) return res.status(400).json({ error: 'sea_not_allowed' });
    if (trows[0].owner_faction_id) return res.status(400).json({ error: 'tile_already_owned' });

    const { rows: fexist } = await db.query('SELECT 1 FROM factions WHERE name=$1', [name]);
    if (fexist.length) return res.status(400).json({ error: 'name_taken' });

    const { rows: frows } = await db.query(
      'INSERT INTO factions(name,color,flag_url,capital_tile_id) VALUES($1,$2,$3,$4) RETURNING id,name,color,flag_url,capital_tile_id',
      [name, color, flag_url || null, tile_id]
    );
    const faction = frows[0];

    await db.query(
      'UPDATE tiles SET owner_faction_id=$1, capture=100, population=10 WHERE id=$2',
      [faction.id, tile_id]
    );

    io.emit('world:update', [{ tile_id, owner_faction_id: faction.id, capture: 100 }]);

    res.json({ ok: true, faction, updated_tile: { id: tile_id, owner_faction_id: faction.id, capture: 100 } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'create_failed' });
  }
});

/** —— 管理：重置并重建世界（支持 GET / POST） —— */
async function handleResetWorld(req, res) {
  try {
    const key = (req.query.key || req.headers['x-admin-key'] || '').toString();
    if (!process.env.ADMIN_RESET_KEY || key !== process.env.ADMIN_RESET_KEY) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    await ensureSchema();
    await db.query('TRUNCATE TABLE tiles RESTART IDENTITY CASCADE;');
    await db.query('TRUNCATE TABLE factions RESTART IDENTITY CASCADE;');

    // 使用当前部署版本的生成规则重新生成
    await initWorld();

    res.json({ ok: true, msg: 'World reset and re-initialized' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
}
app.post('/admin/reset-world', handleResetWorld);
app.get('/admin/reset-world', handleResetWorld);

/** Socket */
io.on('connection', (socket) => {
  console.log('socket connected', socket.id);
  socket.on('disconnect', () => console.log('socket disconnected', socket.id));
});

/** 启动 */
async function boot() {
  if (INIT_ON_BOOT) {
    try { await initWorld(); } catch (e) { console.error('initWorld failed:', e); }
  } else {
    await ensureSchema();
  }
  const port = PORT || process.env.PORT || 10000;
  server.listen(port, () => console.log('server up on', port));
}
boot();
