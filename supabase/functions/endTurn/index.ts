// Edge Function: endTurn
// Handles ending a turn (including discard phase)

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  corsHeaders, ok, fail,
  getPlayer, hasWon, playerView,
  createServiceClient, authPlayer, loadGameState, saveGameState,
} from "../_shared/engine.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createServiceClient();

    const body = await req.json();
    const { gameId, discardCardIds } = body;

    const playerId = await authPlayer(supabase, req);
    if (!playerId) return fail("Auth required", 401);

    const loaded = await loadGameState(supabase, gameId);
    if (!loaded) return fail("Game not found", 404);
    const { state, version, roomId } = loaded;

    if (state.currentPlayer !== playerId) {
      return fail("Not your turn");
    }

    const player = getPlayer(state, playerId);

    // ── Discard phase ──
    if (state.phase === 'discard' || (state.phase === 'play' && player.hand.length > 7)) {
      if (!discardCardIds || !Array.isArray(discardCardIds)) {
        const excess = player.hand.length - 7;
        if (excess > 0) {
          state.phase = 'discard';
          await saveGameState(supabase, gameId, state, version);
          return ok({ needsDiscard: true, excess, state: playerView(state, playerId) });
        }
      } else {
        // Validate discards
        for (const id of discardCardIds) {
          if (!player.hand.find((c: any) => c.id === id)) {
            return fail("Card not in hand: " + id);
          }
        }
        const afterCount = player.hand.length - discardCardIds.length;
        if (afterCount > 7) {
          return fail("Must discard to 7 cards");
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
      return fail("Must resolve pending action first");
    }

    // Check hand limit again
    if (player.hand.length > 7) {
      state.phase = 'discard';
      await saveGameState(supabase, gameId, state, version);
      return ok({ needsDiscard: true, excess: player.hand.length - 7, state: playerView(state, playerId) });
    }

    // Check win
    if (hasWon(player)) {
      state.phase = 'finished';
      state.winner = playerId;
      state.log.push({ type: 'win', player: playerId });
      await saveGameState(supabase, gameId, state, version);

      // Update room
      await supabase.from("rooms").update({ status: "finished" }).eq("id", roomId);

      return ok({ winner: playerId, state: playerView(state, playerId) });
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
      saveGameState(supabase, gameId, state, version),
      supabase.from("moves").insert({
        game_id: gameId, player_id: playerId,
        move_type: 'end_turn', move_data: {},
      }),
    ]);

    return ok({ state: playerView(state, playerId) });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

