const state = { tiles: [], factions: [], W: 0, H: 0, selTileId: null };
const canvas = document.getElementById('map');
const ctx = canvas.getContext('2d');
const factionsDiv = document.getElementById('factions');
const tileInfo = document.getElementById('tile_info');
const statusDiv = document.getElementById('status');
const btnCreate = document.getElementById('btn_create');
const fName = document.getElementById('f_name');
const fColor = document.getElementById('f_color');
const fFlag = document.getElementById('f_flag');
const createMsg = document.getElementById('create_msg');

const socket = io('/', { path: '/socket.io' });
socket.on('connect', ()=> console.log('socket connected'));
socket.on('world:update', (diffs)=>{
  diffs.forEach(d=>{
    const t = state.tiles.find(x=> x.id === d.tile_id);
    if (t){
      t.owner_faction_id = d.owner_faction_id;
      if (typeof d.capture === 'number') t.capture = d.capture;
    }
  });
  draw();
  renderFactionList();
});

async function fetchState(){
  statusDiv.textContent = '加载世界…';
  const res = await fetch('/api/state');
  const data = await res.json();
  state.tiles = data.tiles;
  state.factions = data.factions;
  state.W = Math.max(...state.tiles.map(t=>t.x)) + 1;
  state.H = Math.max(...state.tiles.map(t=>t.y)) + 1;
  statusDiv.textContent = `世界大小：${state.W}×${state.H}，地块数：${state.tiles.length}`;
  draw();
  renderFactionList();
}

function terrainColor(terrain){
  const palette = {
    1: '#3cb371', 2: '#79c267', 3: '#b7d76f',
    4: '#e7d56c', 5: '#d7b36a', 6: '#b08c59', 7: '#7fb7ff'
  };
  return palette[terrain] || '#ccc';
}

function factionColor(fid){
  const f = state.factions.find(f=> f.id === fid);
  return f ? f.color : null;
}

function draw(){
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0,0,W,H);
  if (!state.tiles.length) return;
  const cols = state.W, rows = state.H;
  const cellW = W / cols, cellH = H / rows;

  for (const t of state.tiles){
    const x = t.x * cellW, y = t.y * cellH;
    ctx.fillStyle = terrainColor(t.terrain);
    ctx.fillRect(x, y, cellW, cellH);
  }
  for (const t of state.tiles){
    if (t.owner_faction_id){
      const col = factionColor(t.owner_faction_id);
      if (col){
        ctx.fillStyle = hexToRGBA(col, 0.35);
        ctx.fillRect(t.x*cellW, t.y*cellH, cellW, cellH);
      }
    }
  }
  if (state.selTileId){
    const t = state.tiles.find(x=> x.id === state.selTileId);
    if (t){
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#000';
      ctx.strokeRect(t.x*cellW+1, t.y*cellH+1, cellW-2, cellH-2);
    }
  }
}

function renderFactionList(){
  factionsDiv.innerHTML = '';
  for (const f of state.factions){
    const div = document.createElement('div');
    div.className = 'f-item';
    const sw = document.createElement('span');
    sw.className = 'f-color';
    sw.style.background = f.color;
    const name = document.createElement('span');
    name.textContent = f.name;
    div.appendChild(sw); div.appendChild(name);
    factionsDiv.appendChild(div);
  }
}

canvas.addEventListener('click', (e)=>{
  const rect = canvas.getBoundingClientRect();
  const px = e.clientX - rect.left, py = e.clientY - rect.top;
  const cols = state.W, rows = state.H;
  const cellW = canvas.width / cols, cellH = canvas.height / rows;
  const x = Math.floor(px / cellW), y = Math.floor(py / cellH);
  const t = state.tiles.find(tt=> tt.x===x && tt.y===y);
  if (t){
    state.selTileId = t.id; draw();
    tileInfo.innerHTML = `#${t.id} — 坐标(${t.x},${t.y})<br>地形: ${t.terrain} ${t.terrain===7?'(海洋)':''}<br>资源: ${t.resource}<br>归属: ${ownerName(t.owner_faction_id)}`;
    btnCreate.disabled = !!t.owner_faction_id || !fName.value.trim();
  }
});

[fName, fColor, fFlag].forEach(inp=> inp.addEventListener('input', ()=>{
  const t = state.tiles.find(tt=> tt.id===state.selTileId);
  btnCreate.disabled = !fName.value.trim() || !t || !!(t && t.owner_faction_id);
}));

btnCreate.addEventListener('click', async ()=>{
  const t = state.tiles.find(tt=> tt.id===state.selTileId);
  if (!t){ createMsg.textContent = '请先在地图上选择一个地块'; return; }
  if (t.owner_faction_id){ createMsg.textContent = '该地块已被占领'; return; }
  createMsg.textContent = '';
  const body = {
    name: fName.value.trim(),
    color: fColor.value,
    flag_url: fFlag.value.trim() || null,
    tile_id: t.id
  };
  const res = await fetch('/api/faction', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok){ createMsg.textContent = `创建失败：${data.error || res.status}`; return; }
  state.factions.push(data.faction);
  const tt = state.tiles.find(x=> x.id === data.updated_tile.id);
  if (tt){ tt.owner_faction_id = data.faction.id; tt.capture = 100; }
  draw(); renderFactionList();
  createMsg.textContent = '创建成功！';
});

function ownerName(fid){
  if (!fid) return '无';
  const f = state.factions.find(x=> x.id === fid);
  return f ? f.name : `#${fid}`;
}

function hexToRGBA(hex, alpha){
  const h = hex.replace('#','');
  const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

fetchState();
