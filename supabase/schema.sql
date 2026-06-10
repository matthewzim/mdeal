-- Monopoly Deal - Supabase Schema
-- Run this in your Supabase SQL editor
--
-- Upgrading an existing deployment: re-run the TABLES and ROW LEVEL
-- SECURITY sections (both are idempotent — CREATE IF NOT EXISTS and
-- DROP POLICY IF EXISTS). Skip the REALTIME section if the publication
-- already includes the tables (ALTER PUBLICATION ... ADD TABLE errors on
-- duplicates). Do NOT add game_states to the realtime publication — it
-- holds secret state (deck order, hands) that must never reach clients.

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ══════════════════════════════════════════════════════════════════════
-- TABLES
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS players (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username   TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rooms (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_code  TEXT UNIQUE NOT NULL,
  host_id    UUID REFERENCES players(id) ON DELETE SET NULL,
  status     TEXT NOT NULL DEFAULT 'waiting'
               CHECK (status IN ('waiting', 'playing', 'finished')),
  is_public  BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS room_players (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id       UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  player_id     UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  seat_position INT NOT NULL DEFAULT 0,
  ready_status  BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (room_id, player_id),
  UNIQUE (room_id, seat_position)
);

-- games.game_state_json holds only the PUBLIC view of the game (deck as a
-- count, all hands hidden). It is safe to read and to broadcast over
-- realtime. The authoritative state lives in game_states below.
CREATE TABLE IF NOT EXISTS games (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id         UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  game_state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  current_player  UUID REFERENCES players(id),
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Full authoritative game state: deck order and every player's hand.
-- No RLS policies are defined, so clients can never read or write it;
-- only the service role (edge functions) can. The version column provides
-- optimistic concurrency: every save is conditional on the version read.
CREATE TABLE IF NOT EXISTS game_states (
  game_id    UUID PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  version    INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS moves (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_id    UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id  UUID NOT NULL REFERENCES players(id),
  move_type  TEXT NOT NULL,
  move_data  JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ══════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ══════════════════════════════════════════════════════════════════════

ALTER TABLE players      ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms        ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE games        ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_states  ENABLE ROW LEVEL SECURITY;
ALTER TABLE moves        ENABLE ROW LEVEL SECURITY;

-- All writes except the player's own profile row and ready toggle go
-- through edge functions, which use the service role and bypass RLS.
-- Clients therefore get read-only access plus those two updates, and
-- nothing at all on game_states (no policies = denied).

-- Drop the previous overly-permissive policies if upgrading an existing DB
DROP POLICY IF EXISTS "Players are viewable by everyone"   ON players;
DROP POLICY IF EXISTS "Players can insert their own row"   ON players;
DROP POLICY IF EXISTS "Players can update their own row"   ON players;
DROP POLICY IF EXISTS "Rooms are viewable by everyone"     ON rooms;
DROP POLICY IF EXISTS "Rooms insertable via service role"  ON rooms;
DROP POLICY IF EXISTS "Rooms updatable via service role"   ON rooms;
DROP POLICY IF EXISTS "Room players viewable"              ON room_players;
DROP POLICY IF EXISTS "Room players insertable"            ON room_players;
DROP POLICY IF EXISTS "Room players updatable"             ON room_players;
DROP POLICY IF EXISTS "Room players deletable"             ON room_players;
DROP POLICY IF EXISTS "Games viewable by participants"     ON games;
DROP POLICY IF EXISTS "Games insertable"                   ON games;
DROP POLICY IF EXISTS "Games updatable"                    ON games;
DROP POLICY IF EXISTS "Moves viewable"                     ON moves;
DROP POLICY IF EXISTS "Moves insertable"                   ON moves;

-- Players: anyone can read usernames; only the owner can write their row
CREATE POLICY "Players are viewable by everyone"
  ON players FOR SELECT USING (true);
CREATE POLICY "Players can insert their own row"
  ON players FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Players can update their own row"
  ON players FOR UPDATE USING (auth.uid() = id);

-- Rooms: read-only for clients
CREATE POLICY "Rooms are viewable by everyone"
  ON rooms FOR SELECT USING (true);

-- Room players: readable; a player may update only their own row (ready toggle)
CREATE POLICY "Room players viewable"
  ON room_players FOR SELECT USING (true);
CREATE POLICY "Room players can update own row"
  ON room_players FOR UPDATE USING (auth.uid() = player_id);

-- Games: readable (the row holds only the redacted public view)
CREATE POLICY "Games viewable by everyone"
  ON games FOR SELECT USING (true);

-- Game states: NO client policies — service role only

-- Moves: read-only history
CREATE POLICY "Moves viewable"
  ON moves FOR SELECT USING (true);

-- ══════════════════════════════════════════════════════════════════════
-- REALTIME
-- ══════════════════════════════════════════════════════════════════════

-- Enable realtime for key tables
ALTER PUBLICATION supabase_realtime ADD TABLE games;
ALTER PUBLICATION supabase_realtime ADD TABLE room_players;
ALTER PUBLICATION supabase_realtime ADD TABLE rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE moves;

-- ══════════════════════════════════════════════════════════════════════
-- INDEXES
-- ══════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_rooms_room_code ON rooms(room_code);
CREATE INDEX IF NOT EXISTS idx_room_players_room ON room_players(room_id);
CREATE INDEX IF NOT EXISTS idx_games_room ON games(room_id);
CREATE INDEX IF NOT EXISTS idx_moves_game ON moves(game_id);
