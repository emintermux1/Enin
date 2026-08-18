-- VICEBLOCK persistence schema (Postgres target).
-- The playable slice currently uses a JSON file store with the same fields.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  guest BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallets (
  address TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  verified_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  x REAL NOT NULL,
  y REAL NOT NULL,
  heading REAL NOT NULL DEFAULT 0,
  health INTEGER NOT NULL DEFAULT 100,
  armor INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS inventories (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL REFERENCES characters(id)
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id TEXT PRIMARY KEY,
  inventory_id TEXT NOT NULL REFERENCES inventories(id),
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  qty INTEGER NOT NULL,
  rarity TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vehicles (
  id TEXT PRIMARY KEY,
  def_id TEXT NOT NULL,
  owner_id TEXT,
  registered BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS properties (
  id TEXT PRIMARY KEY,
  owner_id TEXT,
  kind TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS missions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  cash INTEGER NOT NULL,
  xp INTEGER NOT NULL,
  street_rep INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mission_progress (
  user_id TEXT NOT NULL REFERENCES users(id),
  mission_id TEXT NOT NULL REFERENCES missions(id),
  completed_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, mission_id)
);

CREATE TABLE IF NOT EXISTS achievements (
  user_id TEXT NOT NULL,
  code TEXT NOT NULL,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, code)
);

CREATE TABLE IF NOT EXISTS crews (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  emblem TEXT
);

CREATE TABLE IF NOT EXISTS crew_members (
  crew_id TEXT NOT NULL REFERENCES crews(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (crew_id, user_id)
);

CREATE TABLE IF NOT EXISTS friends (
  user_id TEXT NOT NULL,
  friend_id TEXT NOT NULL,
  PRIMARY KEY (user_id, friend_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  amount INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS marketplace_listings (
  id TEXT PRIMARY KEY,
  mint TEXT NOT NULL,
  seller TEXT NOT NULL,
  price_sol NUMERIC NOT NULL,
  sold BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS marketplace_sales (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES marketplace_listings(id),
  buyer TEXT NOT NULL,
  sold_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS anti_cheat_events (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  kind TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS player_stats (
  user_id TEXT PRIMARY KEY,
  cash INTEGER NOT NULL DEFAULT 500,
  bank INTEGER NOT NULL DEFAULT 0,
  xp INTEGER NOT NULL DEFAULT 0,
  street_rep INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS world_events (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS leaderboards (
  board TEXT NOT NULL,
  user_id TEXT NOT NULL,
  score INTEGER NOT NULL,
  PRIMARY KEY (board, user_id)
);

CREATE TABLE IF NOT EXISTS season_progress (
  user_id TEXT NOT NULL,
  season TEXT NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, season)
);
