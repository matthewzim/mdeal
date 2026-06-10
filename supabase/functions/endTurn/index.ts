// Edge Function: endTurn
// Handles ending a turn (including discard phase)

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ALL_COLORS = ['brown','darkblue','lightblue','pink','orange','red','yellow','green','railroad','utility'];
const SET_REQUIREMENTS: Record<string, number> = {
  brown: 2, darkblue: 2, lightblue: 3, pink: 3, orange: 3,
  red: 3, yellow: 3, green: 3, railroad: 4, utility: 2,
};

function getPlayer(state: any, id: string) {
  return state.players.find((p: any) => p.id === id);
}

function countColor(player: any, color: string) {
  let c = 0;
  for (const card of player.properties) {
    if (card.type === 'property' && card.color === color) c++;
    if (card.type === 'wild_property' && card.currentColor === color) c++;
  }
  return c;
}

function isSetComplete(player: any, color: string) {
  return countColor(player, color) >= (SET_REQUIREMENTS[color] || 999);
}

function hasWon(player: any) {
  let sets = 0;
  for (const color of ALL_COLORS) {
    if (isSetComplete(player, color)) sets++;
  }
  return sets >= 3;
}

function playerView(state: any, playerId: string) {
  return {
    ...state,
    deck: state.deck.length,
    players: state.players.map((p: any) => ({
      ...p,
      hand: p.id === playerId ? p.hand : p.hand.map(() => ({ id: 'hidden', type: 'hidden' })),
    })),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();
    const { gameId, discardCardIds } = body;

    // Auth
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");
    if (!token) {
      return new Response(JSON.stringify({ error: "Auth required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) {
      return new Response(JSON.stringify({ error: "Invalid auth" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const playerId = user.id;

    // Fetch game
    const { data: game } = await supabase
      .from("games").select("*").eq("id", gameId).single();
    if (!game) {
      return new Response(JSON.stringify({ error: "Game not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const state = game.game_state_json;
    if (state.currentPlayer !== playerId) {
      return new Response(JSON.stringify({ error: "Not your turn" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const player = getPlayer(state, playerId);

    // ── Discard phase ──
    if (state.phase === 'discard' || (state.phase === 'play' && player.hand.length > 7)) {
      if (!discardCardIds || !Array.isArray(discardCardIds)) {
        const excess = player.hand.length - 7;
        if (excess > 0) {
          state.phase = 'discard';
          await saveState(supabase, gameId, state);
          return new Response(
            JSON.stringify({ needsDiscard: true, excess, state: playerView(state, playerId) }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      } else {
        // Validate discards
        for (const id of discardCardIds) {
          if (!player.hand.find((c: any) => c.id === id)) {
            return new Response(JSON.stringify({ error: "Card not in hand: " + id }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
        }
        const afterCount = player.hand.length - discardCardIds.length;
        if (afterCount > 7) {
          return new Response(JSON.stringify({ error: "Must discard to 7 cards" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        // Do discard
        for (const id of discardCardIds) {
          const idx = player.hand.findIndex((c: any) => c.id === id);
          if (idx !== -1) {
            const [card] = player.hand.splice(idx, 1);
            state.discardPile.push(card);
          }
        }
        state.log.push({ type: 'discard', player: playerId, count: discardCardIds.length });
      }
    }

    if (state.pendingAction) {
      return new Response(JSON.stringify({ error: "Must resolve pending action first" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Check hand limit again
    if (player.hand.length > 7) {
      state.phase = 'discard';
      await saveState(supabase, gameId, state);
      return new Response(
        JSON.stringify({ needsDiscard: true, excess: player.hand.length - 7, state: playerView(state, playerId) }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check win
    if (hasWon(player)) {
      state.phase = 'finished';
      state.winner = playerId;
      state.log.push({ type: 'win', player: playerId });
      await saveState(supabase, gameId, state);

      // Update room
      await supabase.from("rooms").update({ status: "finished" }).eq("id", game.room_id);

      return new Response(
        JSON.stringify({ winner: playerId, state: playerView(state, playerId) }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Advance turn
    const idx = state.players.findIndex((p: any) => p.id === state.currentPlayer);
    const nextIdx = (idx + 1) % state.players.length;
    state.currentPlayer = state.players[nextIdx].id;
    state.turnPlaysRemaining = 3;
    state.phase = 'draw';
    state.turnDrawn = false;
    state.log.push({ type: 'end_turn', player: playerId });

    await Promise.all([
      saveState(supabase, gameId, state),
      supabase.from("moves").insert({
        game_id: gameId, player_id: playerId,
        move_type: 'end_turn', move_data: {},
      }),
    ]);

    return new Response(
      JSON.stringify({ state: playerView(state, playerId) }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function saveState(supabase: any, gameId: string, state: any) {
  await supabase.from("games").update({
    game_state_json: state,
    current_player: state.currentPlayer,
  }).eq("id", gameId);
}
