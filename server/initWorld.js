const db = require('./db');
const { WORLD_W, WORLD_H } = require('./config');
const { hash32, round2 } = require('./utils');
const fs = require('fs');
const path = require('path');

async function ensureSchema(){
  const sql = fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8');
  await db.query(sql);
}

/* =========================
   Perlin-like 2D Gradient Noise
   ========================= */
// 经典 Perlin 的平滑函数
function fade(t){ return t*t*t*(t*(t*6 - 15) + 10); } // 6t^5 - 15t^4 + 10t^3
function lerp(a,b,t){ return a + (b-a)*t; }

// 用 hash32 生成每个整点格子的单位梯度向量（角度法）
function grad2(ix, iy){
  const u = hash32(ix, iy);         // [0,1)
  const ang = u * Math.PI * 2;      // 0~2π
  return { gx: Math.cos(ang), gy: Math.sin(ang) };
}

// 单次 Perlin：返回约 [-1,1]
function perlin2(x, y){
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = x0 + 1, y1 = y0 + 1;

  const sx = fade(x - x0);
  const sy = fade(y - y0);

  const g00 = grad2(x0, y0);
  const g10 = grad2(x1, y0);
  const g01 = grad2(x0, y1);
  const g11 = grad2(x1, y1);

  const dx0 = x - x0, dy0 = y - y0;
  const dx1 = x - x1, dy1 = y - y1;

  const n00 = g00.gx*dx0 + g00.gy*dy0;
  const n10 = g10.gx*dx1 + g10.gy*dy0;
  const n01 = g01.gx*dx0 + g01.gy*dy1;
  const n11 = g11.gx*dx1 + g11.gy*dy1;

  const ix0 = lerp(n00, n10, sx);
  const ix1 = lerp(n01, n11, sx);
  const value = lerp(ix0, ix1, sy);
  return value; // ~[-sqrt(0.5), sqrt(0.5)]，近似 [-1,1]
}

// 多八度 fBm，得到 [-1,1]，再归一化到 [0,1]
function fbmPerlin(x, y, { scale=0.008, octaves=5, lacunarity=2.0, gain=0.5 } = {}){
  // scale 越小 => 地形越“大块连片”；0.008~0.012 比较像大陆级别
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o=0; o<octaves; o++){
    sum += amp * perlin2(x * scale * freq, y * scale * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  const v = sum / (norm || 1);      // ~[-1,1]
  return (v + 1) * 0.5;             // => [0,1]
}

/* ============ 生成海拔 & 海陆 ============ */
function genElevationAndSea(W, H) {
  const elev = Array.from({length:H}, ()=> Array(W));
  const sea  = Array.from({length:H}, ()=> Array(W));

  // 海陆比例（阈值）：0.48~0.54 可调
  const seaThreshold = 0.52;

  for (let y=0; y<H; y++){
    for (let x=0; x<W; x++){
      // 大片连通的“大陆/海洋”形态来自 Perlin fBm
      let e = fbmPerlin(x, y, { scale: 0.008, octaves: 5, lacunarity: 2.0, gain: 0.5 });

      // 赤道（中间横线）抬升，低纬更容易成为陆地
      const lat = Math.abs(y/(H-1) - 0.5) * 2; // 0 赤道，1 两极
      e += (1 - lat) * 0.10;                   // 0.08~0.15 可调
      // 高纬适度降低
      e -= lat * 0.03;

      // 少量扰动避免硬边
      e += (hash32(x+31, y+47) - 0.5) * 0.01;

      // 夹紧到 0..1
      e = Math.max(0, Math.min(1, e));

      elev[y][x] = e;
      sea[y][x]  = (e < seaThreshold);
    }
  }
  return { elev, sea, seaThreshold };
}

/* ============ 计算到海的距离（近似“内陆程度”） ============ */
function distanceToSea(sea, W, H){
  const INF = 1e9;
  const dist = Array.from({length:H}, ()=> Array(W).fill(INF));
  const qx = [], qy = [];
  for (let y=0;y<H;y++) for (let x=0;x<W;x++){
    if (sea[y][x]) { dist[y][x]=0; qx.push(x); qy.push(y); }
  }
  let head=0;
  const DX=[1,-1,0,0], DY=[0,0,1,-1];
  while (head<qx.length){
    const x=qx[head], y=qy[head]; head++;
    const d=dist[y][x]+1;
    for (let k=0;k<4;k++){
      const nx=x+DX[k], ny=y+DY[k];
      if (nx<0||ny<0||nx>=W||ny>=H) continue;
      if (d<dist[ny][nx]){ dist[ny][nx]=d; qx.push(nx); qy.push(ny); }
    }
  }
  let maxD=1;
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) if (!sea[y][x]) maxD = Math.max(maxD, dist[y][x]);
  return { dist, maxD };
}

/* ============ 从海拔/纬度/内陆度映射到 1..6（7=海） ============ */
function terrainFrom(elev, sea, distSea, maxD, x, y, H){
  if (sea[y][x]) return 7;

  const continental = Math.min(1, distSea[y][x] / maxD); // 离海越远越“内陆”
  const lat = Math.abs(y/(H-1) - 0.5) * 2;

  // 恶劣度：内陆为主，纬度次之；赤道明显更优
  let harsh = continental * 0.60 + lat * 0.15 + elev[y][x] * 0.10;
  harsh -= (1 - lat) * 0.30; // 赤道友好（0.25~0.40 可调）
  harsh += (hash32(x+7, y+9) - 0.5) * 0.05;

  harsh = Math.max(0, Math.min(1, harsh));
  const level = 1 + Math.floor(harsh * 6);
  return Math.min(6, Math.max(1, level));
}

function baseResource(terrain){
  const max = 1.6, min = 0.30; // 等级小→资源高
  const rank = terrain - 1;    // 0..5
  return max - (max - min) * (rank / 5);
}

/* ============ 主初始化流程 ============ */
async function initWorld({width=WORLD_W, height=WORLD_H}={}){
  await ensureSchema();
  const { rows: countRows } = await db.query('SELECT COUNT(*)::int AS n FROM tiles');
  if (countRows[0].n > 0) { console.log('[initWorld] 已存在 tiles，跳过初始化。'); return; }

  console.log(`[initWorld] 生成世界 ${width}x${height} ...`);

  // 1) 海拔 & 海陆（Perlin fBm 大片连通）
  const { elev, sea } = genElevationAndSea(width, height);

  // 2) 内陆程度
  const { dist, maxD } = distanceToSea(sea, width, height);

  // 3) 批量入库
  const batchSize = 2000;
  const values = [];
  let inserted = 0;
  for (let y=0; y<height; y++){
    for (let x=0; x<width; x++){
      const terrain = terrainFrom(elev, sea, dist, maxD, x, y, height);
      const noise = hash32(x+17, y+23);
      const res = round2(baseResource(terrain) * (0.92 + noise*0.22));
      values.push({ x, y, terrain, resource: res, owner_faction_id: null, population: 0, capture: 0 });

      if (values.length >= batchSize){
        await bulkInsert(values); values.length = 0; inserted += batchSize;
        if (inserted % 10000 === 0) console.log('  inserted', inserted);
      }
    }
  }
  if (values.length) await bulkInsert(values);
  console.log('[initWorld] 完成。');
}

async function bulkInsert(items){
  const cols = ['x','y','terrain','resource','owner_faction_id','population','capture'];
  const params = [];
  const chunks = items.map((it, i)=>{
    const base = i*cols.length;
    params.push(it.x, it.y, it.terrain, it.resource, it.owner_faction_id, it.population, it.capture);
    return `($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7})`;
  }).join(',');
  const sql = `INSERT INTO tiles(${cols.join(',')}) VALUES ${chunks}`;
  await db.query(sql, params);
}

module.exports = { initWorld, ensureSchema };
