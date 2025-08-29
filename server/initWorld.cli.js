const { initWorld } = require('./initWorld');
const { WORLD_W, WORLD_H } = require('./config');

initWorld({ width: WORLD_W, height: WORLD_H })
  .then(()=>{ console.log('init done'); process.exit(0); })
  .catch((e)=>{ console.error(e); process.exit(1); });
