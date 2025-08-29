// 简易伪随机
function hash32(x, y, seed = 1337) {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695040888963407n) % 0xFFFFFFFFn;
  const n = Number(h & 0xFFFFFFFFn);
  let t = n + 0x7ed55d16 + (n << 12);
  t ^= 0xc761c23c ^ (t >>> 19);
  t += 0x165667b1 + (t << 5);
  t ^= 0xd3a2646c ^ (t << 9);
  t += 0xfd7046c5 + (t << 3);
  t ^= 0xb55a4f09 ^ (t >>> 16);
  return (t >>> 0) / 4294967295;
}

function round2(n) { return Math.round(n * 100) / 100; }

function hexToRGBA(hex, alpha = 0.35) {
  const h = hex.replace('#','');
  const r = parseInt(h.slice(0,2),16),
        g = parseInt(h.slice(2,4),16),
        b = parseInt(h.slice(4,6),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

module.exports = { hash32, round2, hexToRGBA };
