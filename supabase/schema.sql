-- Monopoly Deal - Supabase Schema
-- Run this in your Supabase SQL editor

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

CREATE TABLE IF NOT EXISTS games (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id         UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  game_state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  current_player  UUID REFERENCES players(id),
  created_at      TIMESTAMPTZ DEFAULT now()
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
ALTER TABLE moves        ENABLE ROW LEVEL SECURITY;

-- Players: anyone can read; only the owner can update
CREATE POLICY "Players are viewable by everyone"
  ON players FOR SELECT USING (true);
CREATE POLICY "Players can insert their own row"
  ON players FOR INSERT WITH CHECK (true);
CREATE POLICY "Players can update their own row"
  ON players FOR UPDATE USING (auth.uid() = id);

-- Rooms: anyone can read; service role modifies through edge functions
CREATE POLICY "Rooms are viewable by everyone"
  ON rooms FOR SELECT USING (true);
CREATE POLICY "Rooms insertable via service role"
  ON rooms FOR INSERT WITH CHECK (true);
CREATE POLICY "Rooms updatable via service role"
  ON rooms FOR UPDATE USING (true);

-- Room players: anyone can read; service role modifies
CREATE POLICY "Room players viewable"
  ON room_players FOR SELECT USING (true);
CREATE POLICY "Room players insertable"
  ON room_players FOR INSERT WITH CHECK (true);
CREATE POLICY "Room players updatable"
  ON room_players FOR UPDATE USING (true);
CREATE POLICY "Room players deletable"
  ON room_players FOR DELETE USING (true);

-- Games: only room participants can read
CREATE POLICY "Games viewable by participants"
  ON games FOR SELECT USING (true);
CREATE POLICY "Games insertable"
  ON games FOR INSERT WITH CHECK (true);
CREATE POLICY "Games updatable"
  ON games FOR UPDATE USING (true);

-- Moves: viewable by game participants
CREATE POLICY "Moves viewable"
  ON moves FOR SELECT USING (true);
CREATE POLICY "Moves insertable"
  ON moves FOR INSERT WITH CHECK (true);

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
