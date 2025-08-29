const db = require('./db');
const { WORLD_W, WORLD_H } = require('./config');
const { hash32, round2 } = require('./utils');
const fs = require('fs');
const path = require('path');

async function ensureSchema(){
  const sql = fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8');
  await db.query(sql);
}

// 地形生成：噪声+纬度修正
function genTerrain(x, y, W, H){
  const nx = x / W, ny = y / H;
  const n1 = hash32(x, y);
  const n2 = hash32(Math.floor(x*0.5), Math.floor(y*0.5));
  const n3 = hash32(Math.floor(x*0.25), Math.floor(y*0.25));
  const noise = (n1*0.6 + n2*0.3 + n3*0.1);
  const lat = Math.abs(ny - 0.5) * 2;
  const seaBias = 0.15 + 0.35 * lat;
  const seaThreshold = 0.52 + seaBias * 0.2;
  if (noise < seaThreshold) return 7;
  const landVal = (noise - seaThreshold) / (1 - seaThreshold);
  const t = 6 - Math.floor(landVal * 6);
  return Math.min(6, Math.max(1, t));
}

function baseResource(terrain){
  const max = 1.50, min = 0.30;
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

  const batchSize = 2000;
  const values = [];
  let inserted = 0;
  for (let y=0; y<height; y++){
    for (let x=0; x<width; x++){
      const terrain = genTerrain(x, y, width, height);
      const noise = hash32(x+17, y+23);
      const res = round2(baseResource(terrain) * (0.85 + noise*0.3));
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
