module.exports = {
  PORT: process.env.PORT || 8080,
  DATABASE_URL: process.env.DATABASE_URL,
  INIT_ON_BOOT: process.env.INIT_ON_BOOT === 'true',
  WORLD_W: parseInt(process.env.WORLD_W || '200', 10),
  WORLD_H: parseInt(process.env.WORLD_H || '120', 10),
};
