// 纯 Number 的 32 位哈希（稳定可复现，不使用 BigInt）
function hash32(x, y, seed = 1337) {
  // 把输入限制在 32 位整数范围
  let h = Math.imul((x | 0), 374761393) ^ Math.imul((y | 0), 668265263) ^ (seed | 0);
  h ^= h >>> 13;
  h = Math.imul(h, 1274126177);
  h ^= h >>> 16;
  // 归一化到 [0,1)
  return (h >>> 0) / 4294967295;
}

function round2(n) { return Math.round(n * 100) / 100; }

function hexToRGBA(hex, alpha = 0.35) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

module.exports = { hash32, round2, hexToRGBA };
