const db = require('./db');
const { WORLD_W, WORLD_H } = require('./config');
const { hash32, round2 } = require('./utils');
const fs = require('fs');
const path = require('path');

async function ensureSchema(){
  const sql = fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8');
  await db.query(sql);
}

/** 更低频的多八度噪声：形成大块大陆/海洋 */
function fbm(x, y) {
  // 频率越低，形状越大块；按需调系数（0.008 起步）
  const o1 = hash32(Math.floor(x*0.008), Math.floor(y*0.008));
  const o2 = hash32(Math.floor(x*0.016), Math.floor(y*0.016));
  const o3 = hash32(Math.floor(x*0.032), Math.floor(y*0.032));
  const o4 = hash32(Math.floor(x*0.064), Math.floor(y*0.064));
  // 权重偏向低频
  return (o1*0.60 + o2*0.25 + o3*0.10 + o4*0.05);
}

/** 生成 elevation（0~1）与海洋掩码（7 表示海） */
function genElevationAndSea(W, H) {
  const elev = Array.from({length:H}, ()=> Array(W));
  const sea  = Array.from({length:H}, ()=> Array(W));
  const seaThreshold = 0.50; // 调海陆比例：0.45 少海 / 0.55 多海

  for (let y=0; y<H; y++){
    for (let x=0; x<W; x++){
      let e = fbm(x, y);

      // 纬度（0 赤道，1 两极）
      const lat = Math.abs(y/(H-1) - 0.5) * 2;

      // —— 赤道抬升：让中低纬更容易成为陆地（大块连通）
      //   equatorBoost 越大，赤道区域越容易是陆地
      const equatorBoost = 0.10;           // 可调：0.06~0.15
      const equatorPower = 1.5;            // 可调：1~2，越大越集中在赤道附近
      e += equatorBoost * Math.pow(1 - lat, equatorPower);

      // 高纬轻度压低（保留些极地海/冰原感）
      e -= lat * 0.05;

      // 轻微随机扰动，避免边界过直
      e += (hash32(x+13, y+29) - 0.5) * 0.015;

      // 夹紧
      e = Math.max(0, Math.min(1, e));

      elev[y][x] = e;
      sea[y][x]  = (e < seaThreshold);
    }
  }
  return { elev, sea, seaThreshold };
}

/** 到海的曼哈顿距离（近似“内陆程度”） */
function distanceToSea(sea, W, H){
  const INF = 1e9;
  const dist = Array.from({length:H}, ()=> Array(W).fill(INF));
  const qx = [], qy = [];
  for (let y=0; y<H; y++) for (let x=0; x<W; x++) {
    if (sea[y][x]) { dist[y][x]=0; qx.push(x); qy.push(y); }
  }
  let head = 0;
  const DX=[1,-1,0,0], DY=[0,0,1,-1];
  while (head<qx.length){
    const x=qx[head], y=qy[head]; head++;
    const d = dist[y][x] + 1;
    for (let k=0;k<4;k++){
      const nx=x+DX[k], ny=y+DY[k];
      if (nx<0||ny<0||nx>=W||ny>=H) continue;
      if (d < dist[ny][nx]) { dist[ny][nx]=d; qx.push(nx); qy.push(ny); }
    }
  }
  let maxD=1;
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) if (!sea[y][x]) maxD = Math.max(maxD, dist[y][x]);
  return { dist, maxD };
}

/** 根据 “内陆程度 + 纬度” 映射 1..6（7=海）——赤道更优良 */
function terrainFrom(elev, sea, distSea, maxD, x, y, H){
  if (sea[y][x]) return 7;

  const continental = Math.min(1, distSea[y][x] / maxD);       // 内陆程度越大→越恶劣
  const lat = Math.abs(y/(H-1) - 0.5) * 2;                     // 0 赤道、1 两极

  // 恶劣度：显著降低低纬度（靠近中线越优良）
  //   - continental：产生内陆越恶劣
  //   - lat：高纬更恶劣，但权重较低
  //   - equatorFavor：对赤道强力加成（降低恶劣度）
  let harsh = continental * 0.65 + lat * 0.15 + (elev[y][x])*0.05;
  const equatorFavor = 0.35;                 // 可调：0.25~0.45，越大越“赤道友好”
  harsh -= equatorFavor * Math.pow(1 - lat, 1.2);

  // 少量随机，避免硬边
  harsh += (hash32(x+5, y+9) - 0.5) * 0.06;

  harsh = Math.max(0, Math.min(1, harsh));
  const level = 1 + Math.floor(harsh * 6);   // 1..7
  return Math.min(6, Math.max(1, level));
}

function baseResource(terrain){
  // 等级越低（更优良）→ 资源越高
  const max = 1.60, min = 0.30;   // 小幅提高上限，凸显优良地块
  const steps = 6;
  const rank = (terrain - 1);
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

  // 1) 大块海陆形态 + elevation
  const { elev, sea } = genElevationAndSea(width, height);

  // 2) 距海距离 => 内陆程度（决定恶劣度基调）
  const { dist, maxD } = distanceToSea(sea, width, height);

  // 3) 批量写入
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
