const state = { tiles: [], factions: [], W: 0, H: 0, selTileId: null, createMode: false };
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
const btnCreateMode = document.getElementById('btn_create_mode');
const btnCancelMode = document.getElementById('btn_cancel_mode');

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
  draw(); renderFactionList();
});

// 视图控制（缩放/拖拽）
const view = { scale: 1, min: 0.6, max: 4, offsetX: 0, offsetY: 0, dragging: false, lastX: 0, lastY: 0 };
canvas.addEventListener('wheel', (e)=>{
  e.preventDefault();
  const dir = e.deltaY > 0 ? 0.9 : 1.1;
  const prev = view.scale;
  view.scale = clamp(prev * dir, view.min, view.max);
  const rect = canvas.getBoundingClientRect();
  const mx = (e.clientX - rect.left), my = (e.clientY - rect.top);
  view.offsetX = mx - (mx - view.offsetX) * (view.scale/prev);
  view.offsetY = my - (my - view.offsetY) * (view.scale/prev);
  drawHover(e); draw();
}, { passive:false });

canvas.addEventListener('mousedown',(e)=>{ view.dragging = true; view.lastX = e.clientX; view.lastY = e.clientY; });
window.addEventListener('mouseup',()=> view.dragging=false);
window.addEventListener('mousemove',(e)=>{
  if (view.dragging){
    view.offsetX += (e.clientX - view.lastX);
    view.offsetY += (e.clientY - view.lastY);
    view.lastX = e.clientX; view.lastY = e.clientY;
    draw();
  }
  drawHover(e);
});
function clamp(n,a,b){ return Math.max(a, Math.min(b,n)); }

let hoverTile = null;
function drawHover(e){
  if (!e){ hoverTile=null; return; }
  const { x, y } = screenToCell(e);
  const t = getTileAt(x,y);
  hoverTile = t || null;
  if (t){
    tileInfo.innerHTML = renderTileInfo(t);
    updateCreateButton();
  }
}

function screenToCell(e){
  const rect = canvas.getBoundingClientRect();
  const px = (e.clientX - rect.left - view.offsetX) / view.scale;
  const py = (e.clientY - rect.top  - view.offsetY) / view.scale;
  const cellW = canvas.width / Math.max(1,state.W), cellH = canvas.height / Math.max(1,state.H);
  const x = Math.floor(px / cellW), y = Math.floor(py / cellH);
  return { x, y };
}
function getTileAt(x,y){ return state.tiles.find(tt=> tt.x===x && tt.y===y); }

async function fetchState(){
  statusDiv.textContent = '加载世界…';
  const res = await fetch('/api/state');
  const data = await res.json();

  state.tiles = data.tiles || [];
  state.factions = data.factions || [];
  const meta = data.meta || { w: 0, h: 0, n: 0 };
  state.W = meta.w || 0;
  state.H = meta.h || 0;

  if (!meta.n) {
    statusDiv.innerHTML = '世界尚未初始化（地块数为 0）。请确认服务端环境变量：<code>DATABASE_URL</code> 正确，<code>INIT_ON_BOOT=true</code>，然后重启服务。';
  } else {
    statusDiv.textContent = `世界大小：${state.W}×${state.H}，地块数：${meta.n}`;
  }

  draw(); renderFactionList();
}

function terrainColor(terrain){
  const palette = { 1:'#3cb371',2:'#79c267',3:'#b7d76f',4:'#e7d56c',5:'#d7b36a',6:'#b08c59',7:'#7fb7ff' };
  return palette[terrain] || '#ccc';
}
function factionColor(fid){
  const f = state.factions.find(f=> f.id === fid);
  return f ? f.color : null;
}

function draw(){
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0,0,W,H);
  if (!state.tiles.length || !state.W || !state.H) {
    ctx.fillStyle = '#f6f6f6'; ctx.fillRect(0,0,W,H);
    ctx.fillStyle = '#999'; ctx.font = '16px system-ui, Arial';
    ctx.fillText('世界尚未初始化，无法显示地图。', 20, 40);
    return;
  }

  ctx.save();
  ctx.translate(view.offsetX, view.offsetY);
  ctx.scale(view.scale, view.scale);

  const cellW = W / state.W, cellH = H / state.H;

  // 地形
  for (const t of state.tiles){
    ctx.fillStyle = terrainColor(t.terrain);
    ctx.fillRect(t.x*cellW, t.y*cellH, cellW, cellH);
  }
  // 阵营叠色
  for (const t of state.tiles){
    if (t.owner_faction_id){
      const col = factionColor(t.owner_faction_id);
      if (col){
        ctx.fillStyle = hexToRGBA(col, 0.35);
        ctx.fillRect(t.x*cellW, t.y*cellH, cellW, cellH);
      }
    }
  }
  // 创建模式：可占格高亮
  if (state.createMode){
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#00ff00';
    for (const t of state.tiles){
      if (!t.owner_faction_id && t.terrain !== 7){
        ctx.fillRect(t.x*cellW, t.y*cellH, cellW, cellH);
      }
    }
    ctx.globalAlpha = 1;
  }
  // 选中/悬停描边
  if (state.selTileId){
    const t = state.tiles.find(x=> x.id === state.selTileId);
    if (t){
      ctx.lineWidth = 2/view.scale;
      ctx.strokeStyle = '#000';
      ctx.strokeRect(t.x*cellW+1, t.y*cellH+1, cellW-2, cellH-2);
    }
  }
  if (hoverTile){
    ctx.lineWidth = 2/view.scale;
    ctx.strokeStyle = state.createMode ? '#2ecc71' : '#000';
    ctx.strokeRect(hoverTile.x*cellW+0.5, hoverTile.y*cellH+0.5, cellW-1, cellH-1);
  }

  ctx.restore();
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
  if (!state.W || !state.H) return;
  const { x, y } = screenToCell(e);
  const t = getTileAt(x,y);
  if (!t) return;

  if (!state.createMode){
    state.selTileId = t.id; draw();
    tileInfo.innerHTML = renderTileInfo(t);
    updateCreateButton();
    return;
  }

  if (t.owner_faction_id || t.terrain === 7){
    createMsg.textContent = '请选择未被占领的陆地格';
    return;
  }
  createMsg.textContent = '';
  state.selTileId = t.id;
  draw();
  tileInfo.innerHTML = renderTileInfo(t) + `<br><b>已选择此格作为初始地块</b>`;
  updateCreateButton();
});

function renderTileInfo(t){
  return `#${t.id} — 坐标(${t.x},${t.y})<br>地形: ${t.terrain} ${t.terrain===7?'(海洋)':''}<br>资源: ${t.resource}<br>归属: ${ownerName(t.owner_faction_id)}`;
}

[fName, fColor, fFlag].forEach(inp=> inp.addEventListener('input', updateCreateButton));
function updateCreateButton(){
  const t = state.tiles.find(tt=> tt && tt.id===state.selTileId);
  const okName = !!fName.value.trim();
  const okTile = !!t && !t.owner_faction_id && t.terrain !== 7;
  btnCreate.disabled = !(okName && okTile);
}

btnCreateMode.addEventListener('click', ()=>{
  state.createMode = true;
  btnCreateMode.style.display='none';
  btnCancelMode.style.display='inline-block';
  createMsg.textContent = '创建模式：滚轮缩放、拖拽浏览，点击一个未占领陆地格作为初始地。';
  draw();
});
btnCancelMode.addEventListener('click', ()=>{
  state.createMode = false;
  btnCreateMode.style.display='inline-block';
  btnCancelMode.style.display='none';
  createMsg.textContent = '';
  draw();
});

btnCreate.addEventListener('click', async ()=>{
  const t = state.tiles.find(tt=> tt.id===state.selTileId);
  if (!t){ createMsg.textContent = '请先选择一个地块'; return; }
  if (t.owner_faction_id || t.terrain === 7){ createMsg.textContent = '请选择未被占领的陆地格'; return; }
  if (!fName.value.trim()){ createMsg.textContent = '请输入阵营名称'; return; }

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
  state.createMode = false; btnCreateMode.style.display='inline-block'; btnCancelMode.style.display='none';
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
