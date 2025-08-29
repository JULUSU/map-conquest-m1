-- 世界地块
CREATE TABLE IF NOT EXISTS tiles (
  id SERIAL PRIMARY KEY,
  x INT NOT NULL,
  y INT NOT NULL,
  terrain INT NOT NULL CHECK (terrain BETWEEN 1 AND 7), -- 7=海洋
  resource NUMERIC(6,2) NOT NULL DEFAULT 0,
  owner_faction_id INT NULL,
  population NUMERIC(12,2) NOT NULL DEFAULT 0,
  capture INT NOT NULL DEFAULT 0,
  UNIQUE (x, y)
);

-- 阵营
CREATE TABLE IF NOT EXISTS factions (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  color TEXT NOT NULL,      -- #rrggbb
  flag_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  capital_tile_id INT NULL REFERENCES tiles(id)
);

-- 外键：tile -> faction
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_tiles_owner_faction'
  ) THEN
    ALTER TABLE tiles
    ADD CONSTRAINT fk_tiles_owner_faction
    FOREIGN KEY (owner_faction_id) REFERENCES factions(id) ON DELETE SET NULL;
  END IF;
END $$;
