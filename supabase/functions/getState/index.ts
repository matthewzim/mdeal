// Edge Function: getState
// Returns the requesting player's view of a game (own hand visible,
// opponents' hands hidden, deck as a count). This is the only way a
// client can obtain its hand — the games table stores a fully redacted
// public view, and game_states (the authoritative state) is not readable
// by clients at all.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  corsHeaders, ok, fail, getPlayer, playerView,
  createServiceClient, authPlayer, loadGameState,
} from "../_shared/engine.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createServiceClient();

    const { gameId } = await req.json();
    if (!gameId) return fail("gameId required");

    const playerId = await authPlayer(supabase, req);
    if (!playerId) return fail("Auth required", 401);

    const loaded = await loadGameState(supabase, gameId);
    if (!loaded) return fail("Game not found", 404);
    const { state } = loaded;

    // Only participants may fetch a view
    if (!getPlayer(state, playerId)) {
      return fail("Not a participant in this game", 403);
    }

    return ok({ state: playerView(state, playerId) });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
