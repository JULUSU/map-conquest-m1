// server/index.js  —— 最小可验证版本
const express = require('express');
const http = require('http');

const app = express();
app.use(express.json());

// 1) 探针：用来验证“新代码是否真的上线”
app.get('/debug/ping', (req, res) => res.json({ ok: true, ts: Date.now(), version: 'ping-v1' }));

// 2) 管理：重置并重建（GET/POST 都支持）
async function handleResetWorld(req, res) {
  try {
    const key = (req.query.key || req.headers['x-admin-key'] || '').toString();
    if (!process.env.ADMIN_RESET_KEY || key !== process.env.ADMIN_RESET_KEY) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    // ---- 下面这几行替换为你项目里的逻辑 ----
    // 为了能独立跑，这里只回一个成功。确认可达后再换回你的 ensureSchema/initWorld 逻辑。
    res.json({ ok: true, msg: 'RESET endpoint reached (minimal)' });
    // ---------------------------------------
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
app.get('/admin/reset-world', handleResetWorld);
app.post('/admin/reset-world', handleResetWorld);

// 3) 兜底
app.get('/', (_, res) => res.send('OK - minimal server'));
const PORT = process.env.PORT || 10000;
http.createServer(app).listen(PORT, () => console.log('server up on', PORT));
