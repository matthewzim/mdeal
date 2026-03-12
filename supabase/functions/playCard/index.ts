// Edge Function: playCard
// Validates and executes a card play action

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Inline rules/engine helpers ────────────────────────────────────────

const SET_REQUIREMENTS: Record<string, number> = {
  brown: 2, darkblue: 2, lightblue: 3, pink: 3, orange: 3,
  red: 3, yellow: 3, green: 3, railroad: 4, utility: 2,
};

const RENT_VALUES: Record<string, number[]> = {
  brown: [1, 2], darkblue: [3, 8], lightblue: [1, 2, 3],
  pink: [1, 2, 4], orange: [1, 3, 5], red: [2, 3, 6],
  yellow: [2, 4, 6], green: [2, 4, 7], railroad: [1, 2, 3, 4],
  utility: [1, 2],
};

const ALL_COLORS = ['brown','darkblue','lightblue','pink','orange','red','yellow','green','railroad','utility'];

function getPlayer(state: any, id: string) {
  return state.players.find((p: any) => p.id === id);
}

function countColor(player: any, color: string) {
  let count = 0;
  for (const c of player.properties) {
    if (c.type === 'property' && c.color === color) count++;
    if (c.type === 'wild_property' && c.currentColor === color) count++;
  }
  return count;
}

function isSetComplete(player: any, color: string) {
  const req = SET_REQUIREMENTS[color];
  return req ? countColor(player, color) >= req : false;
}

function isInCompletedSet(player: any, card: any) {
  const color = card.type === 'wild_property' ? card.currentColor : card.color;
  return isSetComplete(player, color);
}

function rentAmount(player: any, color: string) {
  const count = countColor(player, color);
  const table = RENT_VALUES[color];
  if (!table || count === 0) return 0;
  return table[Math.min(count, table.length) - 1];
}

function hasWon(player: any) {
  let sets = 0;
  for (const color of ALL_COLORS) {
    if (isSetComplete(player, color)) sets++;
  }
  return sets >= 3;
}

function removeFromHand(player: any, cardId: string) {
  const idx = player.hand.findIndex((c: any) => c.id === cardId);
  if (idx === -1) return null;
  return player.hand.splice(idx, 1)[0];
}

function shuffleDeck(deck: any[]) {
  const arr = [...deck];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function drawCard(state: any) {
  if (state.deck.length === 0) {
    if (state.discardPile.length === 0) return null;
    state.deck = shuffleDeck(state.discardPile);
    state.discardPile = [];
  }
  return state.deck.pop();
}

function drawCards(state: any, playerId: string, count: number) {
  const player = getPlayer(state, playerId);
  const drawn = [];
  for (let i = 0; i < count; i++) {
    const card = drawCard(state);
    if (card) { player.hand.push(card); drawn.push(card); }
  }
  return drawn;
}

// ── Main handler ───────────────────────────────────────────────────────

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
    const { gameId, action, cardId, targetColor, targetId, targetCardId,
            myCardId, doubleCardId, chosenColor } = body;

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
      .from("games")
      .select("*")
      .eq("id", gameId)
      .single();

    if (!game) {
      return new Response(JSON.stringify({ error: "Game not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const state = game.game_state_json;

    if (state.phase === 'finished') {
      return new Response(JSON.stringify({ error: "Game is finished" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Draw phase ──
    if (action === 'draw') {
      if (state.currentPlayer !== playerId) {
        return new Response(JSON.stringify({ error: "Not your turn" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (state.phase !== 'draw') {
        return new Response(JSON.stringify({ error: "Not in draw phase" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const player = getPlayer(state, playerId);
      const drawCount = player.hand.length === 0 ? 5 : 2;
      const drawn = drawCards(state, playerId, drawCount);
      state.turnPlaysRemaining = 3;
      state.phase = 'play';
      state.turnDrawn = true;
      state.log.push({ type: 'draw', player: playerId, count: drawn.length });

      // Save and return drawn cards
      await saveState(supabase, gameId, state);
      // Record move
      await supabase.from("moves").insert({
        game_id: gameId, player_id: playerId,
        move_type: 'draw', move_data: { count: drawn.length },
      });

      return ok({ drawnCards: drawn, state: playerView(state, playerId) });
    }

    // ── Play phase validations ──
    if (action !== 'move_wild') {
      if (state.currentPlayer !== playerId) {
        return fail("Not your turn");
      }
      if (state.phase !== 'play') {
        return fail("Not in play phase (current: " + state.phase + ")");
      }
      if (state.turnPlaysRemaining <= 0) {
        return fail("No plays remaining");
      }
    }

    const player = getPlayer(state, playerId);
    if (!player) return fail("Player not found");

    // ── Play Property ──
    if (action === 'play_property') {
      const card = player.hand.find((c: any) => c.id === cardId);
      if (!card) return fail("Card not in hand");
      if (card.type !== 'property' && card.type !== 'wild_property') return fail("Not a property");

      const removed = removeFromHand(player, cardId);
      if (removed.type === 'wild_property' && chosenColor) {
        if (removed.colors[0] === 'all') {
          if (!ALL_COLORS.includes(chosenColor)) return fail("Invalid color");
        } else if (!removed.colors.includes(chosenColor)) {
          return fail("Wild cannot be that color");
        }
        removed.currentColor = chosenColor;
      }
      player.properties.push(removed);
      state.turnPlaysRemaining--;
      state.log.push({ type: 'play_property', player: playerId, card: removed.name, color: removed.currentColor || removed.color });

      checkWin(state, playerId);
      await saveState(supabase, gameId, state);
      await recordMove(supabase, gameId, playerId, 'play_property', { cardId, chosenColor });
      return ok({ state: playerView(state, playerId) });
    }

    // ── Bank Card ──
    if (action === 'bank') {
      const card = player.hand.find((c: any) => c.id === cardId);
      if (!card) return fail("Card not in hand");
      if (card.type === 'property' || card.type === 'wild_property') {
        return fail("Property cards cannot be banked");
      }
      const removed = removeFromHand(player, cardId);
      player.bank.push(removed);
      state.turnPlaysRemaining--;
      state.log.push({ type: 'bank', player: playerId, card: removed.name, value: removed.value });

      await saveState(supabase, gameId, state);
      await recordMove(supabase, gameId, playerId, 'bank', { cardId });
      return ok({ state: playerView(state, playerId) });
    }

    // ── Pass Go ──
    if (action === 'pass_go') {
      const card = player.hand.find((c: any) => c.id === cardId);
      if (!card || card.actionType !== 'pass_go') return fail("Not a Pass Go card");
      const removed = removeFromHand(player, cardId);
      state.discardPile.push(removed);
      state.turnPlaysRemaining--;
      const drawn = drawCards(state, playerId, 2);
      state.log.push({ type: 'pass_go', player: playerId, drawn: drawn.length });

      await saveState(supabase, gameId, state);
      await recordMove(supabase, gameId, playerId, 'pass_go', { cardId });
      return ok({ drawnCards: drawn, state: playerView(state, playerId) });
    }

    // ── Rent ──
    if (action === 'rent') {
      const card = player.hand.find((c: any) => c.id === cardId);
      if (!card) return fail("Card not in hand");
      if (card.actionType !== 'rent' && card.actionType !== 'multi_rent') return fail("Not a rent card");

      if (card.actionType === 'rent' && !card.rentColors.includes(targetColor)) {
        return fail("Invalid color for rent card");
      }
      if (!ALL_COLORS.includes(targetColor)) return fail("Invalid color");
      if (countColor(player, targetColor) === 0) return fail("No properties of that color");

      let playsNeeded = 1;
      if (doubleCardId) {
        const dc = player.hand.find((c: any) => c.id === doubleCardId);
        if (!dc || dc.actionType !== 'double_rent') return fail("Invalid double rent card");
        playsNeeded = 2;
      }
      if (state.turnPlaysRemaining < playsNeeded) return fail("Not enough plays");

      const removed = removeFromHand(player, cardId);
      state.discardPile.push(removed);
      state.turnPlaysRemaining--;

      let rent = rentAmount(player, targetColor);
      if (doubleCardId) {
        const dc = removeFromHand(player, doubleCardId);
        state.discardPile.push(dc);
        state.turnPlaysRemaining--;
        rent *= 2;
      }

      const targets = state.players.filter((p: any) => p.id !== playerId).map((p: any) => p.id);
      state.pendingAction = {
        type: 'rent', from: playerId,
        targets: targets.map((t: string) => ({ playerId: t, amount: rent, paid: false, cancelled: false })),
        color: targetColor, amount: rent, doubled: !!doubleCardId,
        respondQueue: [...targets],
        currentResponder: targets[0] || null,
      };
      state.phase = 'respond';
      state.log.push({ type: 'rent', player: playerId, color: targetColor, amount: rent, doubled: !!doubleCardId });

      await saveState(supabase, gameId, state);
      await recordMove(supabase, gameId, playerId, 'rent', { cardId, targetColor, doubleCardId });
      return ok({ state: playerView(state, playerId) });
    }

    // ── Debt Collector ──
    if (action === 'debt_collector') {
      const card = player.hand.find((c: any) => c.id === cardId);
      if (!card || card.actionType !== 'debt_collector') return fail("Not a Debt Collector");
      if (targetId === playerId) return fail("Cannot target yourself");
      if (!getPlayer(state, targetId)) return fail("Target not found");

      const removed = removeFromHand(player, cardId);
      state.discardPile.push(removed);
      state.turnPlaysRemaining--;

      state.pendingAction = {
        type: 'debt_collector', from: playerId,
        targets: [{ playerId: targetId, amount: 5, paid: false, cancelled: false }],
        respondQueue: [targetId], currentResponder: targetId,
      };
      state.phase = 'respond';
      state.log.push({ type: 'debt_collector', player: playerId, target: targetId });

      await saveState(supabase, gameId, state);
      await recordMove(supabase, gameId, playerId, 'debt_collector', { cardId, targetId });
      return ok({ state: playerView(state, playerId) });
    }

    // ── Birthday ──
    if (action === 'birthday') {
      const card = player.hand.find((c: any) => c.id === cardId);
      if (!card || card.actionType !== 'birthday') return fail("Not a Birthday card");

      const removed = removeFromHand(player, cardId);
      state.discardPile.push(removed);
      state.turnPlaysRemaining--;

      const targets = state.players.filter((p: any) => p.id !== playerId).map((p: any) => p.id);
      state.pendingAction = {
        type: 'birthday', from: playerId,
        targets: targets.map((t: string) => ({ playerId: t, amount: 2, paid: false, cancelled: false })),
        respondQueue: [...targets], currentResponder: targets[0] || null,
      };
      state.phase = 'respond';
      state.log.push({ type: 'birthday', player: playerId });

      await saveState(supabase, gameId, state);
      await recordMove(supabase, gameId, playerId, 'birthday', { cardId });
      return ok({ state: playerView(state, playerId) });
    }

    // ── Sly Deal ──
    if (action === 'sly_deal') {
      const card = player.hand.find((c: any) => c.id === cardId);
      if (!card || card.actionType !== 'sly_deal') return fail("Not a Sly Deal");
      if (targetId === playerId) return fail("Cannot target yourself");
      const target = getPlayer(state, targetId);
      if (!target) return fail("Target not found");
      const tc = target.properties.find((c: any) => c.id === targetCardId);
      if (!tc) return fail("Target card not found");
      if (isInCompletedSet(target, tc)) return fail("Cannot steal from completed set");

      const removed = removeFromHand(player, cardId);
      state.discardPile.push(removed);
      state.turnPlaysRemaining--;

      state.pendingAction = {
        type: 'sly_deal', from: playerId, targetId, targetCardId,
        respondQueue: [targetId], currentResponder: targetId, cancelled: false,
      };
      state.phase = 'respond';
      state.log.push({ type: 'sly_deal', player: playerId, target: targetId });

      await saveState(supabase, gameId, state);
      await recordMove(supabase, gameId, playerId, 'sly_deal', { cardId, targetId, targetCardId });
      return ok({ state: playerView(state, playerId) });
    }

    // ── Forced Deal ──
    if (action === 'forced_deal') {
      const card = player.hand.find((c: any) => c.id === cardId);
      if (!card || card.actionType !== 'forced_deal') return fail("Not a Forced Deal");
      if (targetId === playerId) return fail("Cannot target yourself");
      const target = getPlayer(state, targetId);
      if (!target) return fail("Target not found");
      const tc = target.properties.find((c: any) => c.id === targetCardId);
      if (!tc) return fail("Target card not found");
      if (isInCompletedSet(target, tc)) return fail("Cannot take from completed set");
      const mc = player.properties.find((c: any) => c.id === myCardId);
      if (!mc) return fail("Your property not found");
      if (isInCompletedSet(player, mc)) return fail("Cannot give from your completed set");

      const removed = removeFromHand(player, cardId);
      state.discardPile.push(removed);
      state.turnPlaysRemaining--;

      state.pendingAction = {
        type: 'forced_deal', from: playerId, targetId, targetCardId, myCardId,
        respondQueue: [targetId], currentResponder: targetId, cancelled: false,
      };
      state.phase = 'respond';
      state.log.push({ type: 'forced_deal', player: playerId, target: targetId });

      await saveState(supabase, gameId, state);
      await recordMove(supabase, gameId, playerId, 'forced_deal', { cardId, targetId, targetCardId, myCardId });
      return ok({ state: playerView(state, playerId) });
    }

    // ── Deal Breaker ──
    if (action === 'deal_breaker') {
      const card = player.hand.find((c: any) => c.id === cardId);
      if (!card || card.actionType !== 'deal_breaker') return fail("Not a Deal Breaker");
      if (targetId === playerId) return fail("Cannot target yourself");
      const target = getPlayer(state, targetId);
      if (!target) return fail("Target not found");
      if (!isSetComplete(target, targetColor)) return fail("Target set not complete");

      const removed = removeFromHand(player, cardId);
      state.discardPile.push(removed);
      state.turnPlaysRemaining--;

      state.pendingAction = {
        type: 'deal_breaker', from: playerId, targetId, targetColor,
        respondQueue: [targetId], currentResponder: targetId, cancelled: false,
      };
      state.phase = 'respond';
      state.log.push({ type: 'deal_breaker', player: playerId, target: targetId, color: targetColor });

      await saveState(supabase, gameId, state);
      await recordMove(supabase, gameId, playerId, 'deal_breaker', { cardId, targetId, targetColor });
      return ok({ state: playerView(state, playerId) });
    }

    // ── Move Wild ──
    if (action === 'move_wild') {
      if (state.currentPlayer !== playerId) return fail("Not your turn");
      const card = player.properties.find((c: any) => c.id === cardId);
      if (!card || card.type !== 'wild_property') return fail("Not a wild property");
      if (card.colors[0] === 'all') {
        if (!ALL_COLORS.includes(chosenColor)) return fail("Invalid color");
      } else if (!card.colors.includes(chosenColor)) {
        return fail("Wild cannot be that color");
      }
      card.currentColor = chosenColor;
      state.log.push({ type: 'move_wild', player: playerId, card: card.name, color: chosenColor });

      await saveState(supabase, gameId, state);
      return ok({ state: playerView(state, playerId) });
    }

    return fail("Unknown action: " + action);

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ── Helpers ──

function checkWin(state: any, playerId: string) {
  const player = getPlayer(state, playerId);
  if (hasWon(player)) {
    state.phase = 'finished';
    state.winner = playerId;
    state.log.push({ type: 'win', player: playerId });
  }
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

async function saveState(supabase: any, gameId: string, state: any) {
  await supabase
    .from("games")
    .update({
      game_state_json: state,
      current_player: state.currentPlayer,
    })
    .eq("id", gameId);
}

async function recordMove(supabase: any, gameId: string, playerId: string, moveType: string, moveData: any) {
  await supabase.from("moves").insert({
    game_id: gameId,
    player_id: playerId,
    move_type: moveType,
    move_data: moveData,
  });
}

function ok(data: any) {
  return new Response(
    JSON.stringify(data),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

function fail(reason: string) {
  return new Response(
    JSON.stringify({ error: reason }),
    { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
