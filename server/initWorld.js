const db = require('./db');
const { WORLD_W, WORLD_H } = require('./config');
const { hash32, round2 } = require('./utils');
const fs = require('fs');
const path = require('path');

async function ensureSchema(){
  const sql = fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8');
  await db.query(sql);
}

/** 低频多八度噪声：scale 小 => 大块结构 */
function fbm(x, y) {
  // 取整采样，避免浮点抖动；不同频率叠加
  const o1 = hash32(Math.floor(x*0.015), Math.floor(y*0.015));
  const o2 = hash32(Math.floor(x*0.03),  Math.floor(y*0.03));
  const o3 = hash32(Math.floor(x*0.06),  Math.floor(y*0.06));
  const o4 = hash32(Math.floor(x*0.12),  Math.floor(y*0.12));
  // 权重：越低频权重越高，形成大洲/海洋
  return (o1*0.55 + o2*0.25 + o3*0.15 + o4*0.05);
}

/** 生成 elevation（0~1），并标记海洋（7） */
function genElevationAndSea(W, H) {
  const elev = new Array(H);
  const sea = new Array(H);
  const seaThreshold = 0.50; // 约一半为海洋，可按需 0.45~0.55 调整

  for (let y=0; y<H; y++){
    elev[y] = new Array(W);
    sea[y]  = new Array(W);
    for (let x=0; x<W; x++){
      // 基础地形（大陆/海洋）
      let e = fbm(x, y);

      // 纬度调制：高纬更冷更“低”（更容易成为海/恶劣）
      const lat = Math.abs(y/(H-1) - 0.5)*2;        // 0 赤道, 1 两极
      e -= lat * 0.08;                              // 高纬稍微压低

      // 轻微随机
      e += (hash32(x+11, y+17) - 0.5) * 0.02;

      // 归一化到 0..1（简单夹紧）
      e = Math.max(0, Math.min(1, e));

      elev[y][x] = e;
      sea[y][x]  = (e < seaThreshold); // 海洋判定
    }
  }
  return { elev, sea, seaThreshold };
}

/** BFS 计算到海的曼哈顿距离（近似“内陆程度”） */
function distanceToSea(sea, W, H){
  const INF = 1e9;
  const dist = Array.from({length:H}, ()=> Array(W).fill(INF));
  const qx = [], qy = [];
  for (let y=0; y<H; y++){
    for (let x=0; x<W; x++){
      if (sea[y][x]) { dist[y][x] = 0; qx.push(x); qy.push(y); }
    }
  }
  let head = 0;
  const DX = [1,-1,0,0], DY=[0,0,1,-1];
  while (head < qx.length){
    const x = qx[head], y = qy[head]; head++;
    const d = dist[y][x] + 1;
    for (let k=0; k<4; k++){
      const nx = x+DX[k], ny = y+DY[k];
      if (nx<0||ny<0||nx>=W||ny>=H) continue;
      if (d < dist[ny][nx]) { dist[ny][nx]=d; qx.push(nx); qy.push(ny); }
    }
  }
  // 找最大距离以做归一化
  let maxD = 1;
  for (let y=0; y<H; y++) for (let x=0; x<W; x++) if (!sea[y][x]) maxD = Math.max(maxD, dist[y][x]);
  return { dist, maxD };
}

/** 将 elevation + continentality 映射为地形等级 1..6（7=海洋） */
function terrainFrom(elev, sea, distSea, maxD, x, y, H){
  if (sea[y][x]) return 7; // 海

  // continentality：离海越远越大（0..1）
  const continental = Math.min(1, distSea[y][x] / maxD);

  // 纬度：越高纬越恶劣（靠近上下边界）
  const lat = Math.abs(y/(H-1) - 0.5)*2; // 0 赤道, 1 两极

  // 基础 elev 越高通常越“内陆高原/山地”
  // 恶劣评分：更多由 continental + lat 决定，稍加噪声
  let harsh = continental*0.65 + lat*0.25 + (elev[y][x])*0.10;
  harsh += (hash32(x+5, y+9)-0.5) * 0.08; // 少量随机
  harsh = Math.max(0, Math.min(1, harsh));

  // 映射到 1..6（数值越大越恶劣）
  // 我们让 0..1 划分为 6 档
  const level = 1 + Math.floor(harsh * 6); // 1..7
  return Math.min(6, Math.max(1, level));
}

function baseResource(terrain){
  // 地块越优良（等级小）→ 资源越高
  const max = 1.50, min = 0.30;
  const steps = 6;                   // terrain: 1..6
  const rank = (terrain - 1);        // 0..5
  const v = max - (max - min) * (rank / (steps - 1));
  return v;
}

async function initWorld({width=WORLD_W, height=WORLD_H}={}){
  await ensureSchema();

  const { rows: countRows } = await db.query('SELECT COUNT(*)::int AS n FROM tiles');
  if (countRows[0].n > 0) {
    console.log('[initWorld] 已存在 tiles，跳过初始化。');
    return;
  }

  console.log(`[initWorld] 生成世界 ${width}x${height} ...`);

  // 第一步：大陆/海洋 + elevation
  const { elev, sea } = genElevationAndSea(width, height);

  // 第二步：计算到海距离（用于“内陆程度”）
  const { dist, maxD } = distanceToSea(sea, width, height);

  // 批量写入
  const batchSize = 2000;
  const values = [];
  let inserted = 0;
  for (let y=0; y<height; y++){
    for (let x=0; x<width; x++){
      const terrain = terrainFrom(elev, sea, dist, maxD, x, y, height);
      const noise = hash32(x+17, y+23);
      const res = round2(baseResource(terrain) * (0.90 + noise*0.25));
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
