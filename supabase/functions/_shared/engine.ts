// Shared game helpers for all edge functions.
//
// Single server-side source of truth for rules constants, state access,
// view redaction, and persistence. The browser keeps its own copy of the
// rules in game-engine/ (needed for offline play and client-side
// prediction) — when changing rules here, update game-engine/ to match.
//
// Persistence model:
//   - game_states.state_json  : full authoritative state (deck order, all
//     hands). RLS allows no client access; only the service role reads it.
//   - games.game_state_json   : public view (deck count, ALL hands hidden,
//     including the owner's). Safe to broadcast over realtime to everyone.
//   - Players receive their own hand only via edge function responses
//     (playerView), never via the database or realtime.
//
// Concurrency: game_states.version is checked-and-incremented on every
// save. A concurrent write loses and gets a clean error instead of
// silently clobbering the other player's move.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const ALL_COLORS = ['brown','darkblue','lightblue','pink','orange','red','yellow','green','railroad','utility'];

export const SET_REQUIREMENTS: Record<string, number> = {
  brown: 2, darkblue: 2, lightblue: 3, pink: 3, orange: 3,
  red: 3, yellow: 3, green: 3, railroad: 4, utility: 2,
};

export const RENT_VALUES: Record<string, number[]> = {
  brown: [1, 2], darkblue: [3, 8], lightblue: [1, 2, 3],
  pink: [1, 2, 4], orange: [1, 3, 5], red: [2, 3, 6],
  yellow: [2, 4, 6], green: [2, 4, 7], railroad: [1, 2, 3, 4],
  utility: [1, 2],
};

// Keep the stored log bounded; the UI shows the last 20 entries.
const MAX_LOG_ENTRIES = 100;

// ── Responses ──────────────────────────────────────────────────────────

export function ok(data: any) {
  return new Response(
    JSON.stringify(data),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

export function fail(reason: string, status = 400) {
  return new Response(
    JSON.stringify({ error: reason }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// ── Rules helpers ──────────────────────────────────────────────────────

export function getPlayer(state: any, id: string) {
  return state.players.find((p: any) => p.id === id);
}

export function countColor(player: any, color: string) {
  let count = 0;
  for (const c of player.properties) {
    if (c.type === 'property' && c.color === color) count++;
    if (c.type === 'wild_property' && c.currentColor === color) count++;
  }
  return count;
}

export function isSetComplete(player: any, color: string) {
  const req = SET_REQUIREMENTS[color];
  return req ? countColor(player, color) >= req : false;
}

export function isInCompletedSet(player: any, card: any) {
  const color = card.type === 'wild_property' ? card.currentColor : card.color;
  return isSetComplete(player, color);
}

export function rentAmount(player: any, color: string) {
  const count = countColor(player, color);
  const table = RENT_VALUES[color];
  if (!table || count === 0) return 0;
  let rent = table[Math.min(count, table.length) - 1];
  // Add house bonus (3M each), hotel bonus (4M each), shack bonus (5M each)
  rent += player.properties.filter((c: any) => c.actionType === 'house' && c.attachedColor === color).length * 3;
  rent += player.properties.filter((c: any) => c.actionType === 'hotel' && c.attachedColor === color).length * 4;
  rent += player.properties.filter((c: any) => c.actionType === 'shack' && c.attachedColor === color).length * 5;
  return rent;
}

export function hasWon(player: any) {
  let sets = 0;
  for (const color of ALL_COLORS) {
    if (isSetComplete(player, color)) sets++;
  }
  return sets >= 3;
}

export function bankTotal(player: any) {
  return player.bank.reduce((s: number, c: any) => s + c.value, 0);
}

export function propertyTotal(player: any) {
  return player.properties.reduce((s: number, c: any) => s + c.value, 0);
}

export function totalAssets(player: any) {
  return bankTotal(player) + propertyTotal(player);
}

export function removeFromHand(player: any, cardId: string) {
  const idx = player.hand.findIndex((c: any) => c.id === cardId);
  if (idx === -1) return null;
  return player.hand.splice(idx, 1)[0];
}

export function shuffleDeck(deck: any[]) {
  const arr = [...deck];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function drawCard(state: any) {
  if (state.deck.length === 0) {
    if (state.discardPile.length === 0) return null;
    state.deck = shuffleDeck(state.discardPile);
    state.discardPile = [];
  }
  return state.deck.pop();
}

export function drawCards(state: any, playerId: string, count: number) {
  const player = getPlayer(state, playerId);
  const drawn = [];
  for (let i = 0; i < count; i++) {
    const card = drawCard(state);
    if (card) { player.hand.push(card); drawn.push(card); }
  }
  return drawn;
}

// ── View redaction ─────────────────────────────────────────────────────

// View for one player: own hand visible, everyone else's hidden.
export function playerView(state: any, playerId: string) {
  return {
    ...state,
    deck: state.deck.length,
    players: state.players.map((p: any) => ({
      ...p,
      hand: p.id === playerId ? p.hand : p.hand.map(() => ({ id: 'hidden', type: 'hidden' })),
    })),
  };
}

// View safe to share with everyone: ALL hands hidden, deck as a count.
// This is what gets stored in games.game_state_json and broadcast.
export function publicView(state: any) {
  return {
    ...state,
    deck: state.deck.length,
    players: state.players.map((p: any) => ({
      ...p,
      hand: p.hand.map(() => ({ id: 'hidden', type: 'hidden' })),
    })),
  };
}

// ── Auth & persistence ─────────────────────────────────────────────────

export function createServiceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

export async function authPlayer(supabase: any, req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization");
  const token = authHeader?.replace("Bearer ", "");
  if (!token) return null;
  const { data: { user } } = await supabase.auth.getUser(token);
  return user ? user.id : null;
}

// Load the authoritative state. Legacy games (created before the
// games/game_states split) stored the full state in games.game_state_json;
// migrate those on first access.
export async function loadGameState(supabase: any, gameId: string) {
  const { data: game } = await supabase
    .from("games")
    .select("id, room_id, game_state_json, game_states(state_json, version)")
    .eq("id", gameId)
    .single();
  if (!game) return null;

  const priv = Array.isArray(game.game_states) ? game.game_states[0] : game.game_states;
  if (priv && priv.state_json) {
    return { state: priv.state_json, version: priv.version, roomId: game.room_id };
  }

  // Legacy migration: the games row still holds the full state
  const legacy = game.game_state_json;
  if (legacy && Array.isArray(legacy.deck)) {
    await supabase.from("game_states").upsert({
      game_id: gameId, state_json: legacy, version: 1,
    });
    return { state: legacy, version: 1, roomId: game.room_id };
  }

  return null;
}

// Save with optimistic concurrency: bump seq, trim the log, write the
// private state conditionally on the version we read, then publish the
// public view. Throws if another action saved first.
export async function saveGameState(supabase: any, gameId: string, state: any, expectedVersion: number) {
  state.seq = (state.seq || 0) + 1;
  if (Array.isArray(state.log) && state.log.length > MAX_LOG_ENTRIES) {
    state.log = state.log.slice(-MAX_LOG_ENTRIES);
  }

  const { data: updated, error } = await supabase
    .from("game_states")
    .update({ state_json: state, version: expectedVersion + 1 })
    .eq("game_id", gameId)
    .eq("version", expectedVersion)
    .select("version");
  if (error) throw new Error("Failed to save game state: " + error.message);
  if (!updated || updated.length === 0) {
    throw new Error("Game was updated by another action — please retry");
  }

  await supabase
    .from("games")
    .update({
      game_state_json: publicView(state),
      current_player: state.currentPlayer,
    })
    .eq("id", gameId);
}

export async function recordMove(supabase: any, gameId: string, playerId: string, moveType: string, moveData: any) {
  await supabase.from("moves").insert({
    game_id: gameId,
    player_id: playerId,
    move_type: moveType,
    move_data: moveData,
  });
}
