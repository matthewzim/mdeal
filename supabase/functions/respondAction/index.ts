// Edge Function: respondAction
// Handles Just Say No responses and payment for pending actions

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
  for (const color of ALL_COLORS) if (isSetComplete(player, color)) sets++;
  return sets >= 3;
}

function bankTotal(player: any) {
  return player.bank.reduce((s: number, c: any) => s + c.value, 0);
}

function propertyTotal(player: any) {
  return player.properties.reduce((s: number, c: any) => s + c.value, 0);
}

function totalAssets(player: any) {
  return bankTotal(player) + propertyTotal(player);
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
    const { gameId, response, cardId, bankCardIds, propertyCardIds } = body;
    // response: 'accept' | 'just_say_no' | 'pay'

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
    const pending = state.pendingAction;

    if (!pending) {
      return new Response(JSON.stringify({ error: "No pending action" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Just Say No ──
    if (response === 'just_say_no') {
      const player = getPlayer(state, playerId);
      const card = player.hand.find((c: any) => c.id === cardId);
      if (!card || card.actionType !== 'just_say_no') {
        return fail("Not a Just Say No card");
      }

      // Verify this player is the current responder
      if (pending.currentResponder !== playerId) {
        return fail("Not your turn to respond");
      }

      // Remove card
      const idx = player.hand.findIndex((c: any) => c.id === cardId);
      player.hand.splice(idx, 1);
      state.discardPile.push(card);

      // Toggle cancellation
      if (pending.type === 'rent' || pending.type === 'debt_collector' || pending.type === 'birthday') {
        const target = pending.targets.find((t: any) => t.playerId === playerId);
        if (target) target.cancelled = !target.cancelled;
      } else {
        pending.cancelled = !pending.cancelled;
      }

      // Swap responder (Just Say No chain)
      if (pending.from === playerId) {
        // Initiator countered — find which target had cancelled
        if (pending.targets) {
          const cancelledTarget = pending.targets.find((t: any) => !t.cancelled && !t.paid);
          pending.currentResponder = cancelledTarget ? cancelledTarget.playerId : null;
        } else {
          pending.currentResponder = pending.targetId;
        }
      } else {
        // Target said no — initiator can counter
        pending.currentResponder = pending.from;
      }

      state.log.push({ type: 'just_say_no', player: playerId });

      await saveState(supabase, gameId, state);
      await supabase.from("moves").insert({
        game_id: gameId, player_id: playerId,
        move_type: 'just_say_no', move_data: { cardId },
      });
      return ok({ state: playerView(state, playerId) });
    }

    // ── Accept ──
    if (response === 'accept') {
      if (pending.currentResponder !== playerId && state.phase !== 'pay') {
        return fail("Not your turn to respond");
      }

      if (pending.type === 'rent' || pending.type === 'debt_collector' || pending.type === 'birthday') {
        // Remove from respond queue
        const rIdx = pending.respondQueue.indexOf(playerId);
        if (rIdx !== -1) pending.respondQueue.splice(rIdx, 1);

        if (pending.currentResponder === playerId) {
          pending.currentResponder = pending.respondQueue[0] || null;
        }

        if (pending.respondQueue.length === 0 || pending.currentResponder === null) {
          // Move to payment phase — skip players with no assets
          for (const t of pending.targets) {
            if (!t.cancelled && !t.paid) {
              const p = getPlayer(state, t.playerId);
              if (totalAssets(p) === 0) {
                t.paid = true;
                state.log.push({ type: 'skip_payment', player: t.playerId, reason: 'no_assets' });
              }
            }
          }
          const unpaid = pending.targets.filter((t: any) => !t.cancelled && !t.paid);
          if (unpaid.length > 0) {
            state.phase = 'pay';
            pending.currentPayer = unpaid[0].playerId;
          } else {
            resolveAction(state);
          }
        }
      } else {
        // Single-target actions (sly deal, forced deal, deal breaker)
        if (!pending.cancelled) {
          executePropertyAction(state);
        }
        resolveAction(state);
      }

      await saveState(supabase, gameId, state);
      return ok({ state: playerView(state, playerId) });
    }

    // ── Pay ──
    if (response === 'pay') {
      if (state.phase !== 'pay') return fail("Not in payment phase");
      if (pending.currentPayer !== playerId) return fail("Not your turn to pay");

      const payer = getPlayer(state, playerId);
      const receiver = getPlayer(state, pending.from);
      const target = pending.targets.find((t: any) => t.playerId === playerId);

      if (!target || target.paid || target.cancelled) {
        return fail("No payment required from you");
      }

      const bIds = bankCardIds || [];
      const pIds = propertyCardIds || [];

      // Validate cards exist
      let total = 0;
      for (const id of bIds) {
        const c = payer.bank.find((b: any) => b.id === id);
        if (!c) return fail("Bank card not found: " + id);
        total += c.value;
      }
      for (const id of pIds) {
        const c = payer.properties.find((p: any) => p.id === id);
        if (!c) return fail("Property card not found: " + id);
        total += c.value;
      }

      // Validate sufficient payment
      const assets = totalAssets(payer);
      const required = Math.min(target.amount, assets);
      if (total < required) return fail("Insufficient payment");

      // Transfer
      for (const id of bIds) {
        const idx = payer.bank.findIndex((c: any) => c.id === id);
        if (idx !== -1) {
          const [card] = payer.bank.splice(idx, 1);
          receiver.bank.push(card);
        }
      }
      for (const id of pIds) {
        const idx = payer.properties.findIndex((c: any) => c.id === id);
        if (idx !== -1) {
          const [card] = payer.properties.splice(idx, 1);
          receiver.properties.push(card);
        }
      }

      target.paid = true;
      state.log.push({
        type: 'payment', from: playerId, to: pending.from,
        bankCards: bIds.length, propertyCards: pIds.length,
      });

      // Next payer? Skip those with no assets
      let nextUnpaid = pending.targets.find((t: any) => !t.cancelled && !t.paid);
      while (nextUnpaid) {
        const np = getPlayer(state, nextUnpaid.playerId);
        if (totalAssets(np) === 0) {
          nextUnpaid.paid = true;
          state.log.push({ type: 'skip_payment', player: nextUnpaid.playerId, reason: 'no_assets' });
          nextUnpaid = pending.targets.find((t: any) => !t.cancelled && !t.paid);
        } else {
          break;
        }
      }
      if (nextUnpaid) {
        pending.currentPayer = nextUnpaid.playerId;
      } else {
        resolveAction(state);
      }

      // Check win for receiver (properties might complete sets)
      if (hasWon(receiver)) {
        state.phase = 'finished';
        state.winner = receiver.id;
        state.log.push({ type: 'win', player: receiver.id });
        await supabase.from("rooms").update({ status: "finished" }).eq("id", game.room_id);
      }

      await saveState(supabase, gameId, state);
      await supabase.from("moves").insert({
        game_id: gameId, player_id: playerId,
        move_type: 'payment', move_data: { bankCardIds: bIds, propertyCardIds: pIds },
      });
      return ok({ state: playerView(state, playerId) });
    }

    return fail("Unknown response: " + response);

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function executePropertyAction(state: any) {
  const pending = state.pendingAction;
  const from = getPlayer(state, pending.from);

  if (pending.type === 'sly_deal') {
    const target = getPlayer(state, pending.targetId);
    const idx = target.properties.findIndex((c: any) => c.id === pending.targetCardId);
    if (idx !== -1) {
      const [card] = target.properties.splice(idx, 1);
      from.properties.push(card);
    }
  } else if (pending.type === 'forced_deal') {
    const target = getPlayer(state, pending.targetId);
    const tIdx = target.properties.findIndex((c: any) => c.id === pending.targetCardId);
    const mIdx = from.properties.findIndex((c: any) => c.id === pending.myCardId);
    if (tIdx !== -1 && mIdx !== -1) {
      const [targetCard] = target.properties.splice(tIdx, 1);
      const [myCard] = from.properties.splice(mIdx, 1);
      from.properties.push(targetCard);
      target.properties.push(myCard);
    }
  } else if (pending.type === 'deal_breaker') {
    const target = getPlayer(state, pending.targetId);
    const color = pending.targetColor;
    const setCards = target.properties.filter((c: any) => {
      if (c.type === 'property') return c.color === color;
      if (c.type === 'wild_property') return c.currentColor === color;
      // Include houses/hotels attached to this color
      if ((c.actionType === 'house' || c.actionType === 'hotel') && c.attachedColor === color) return true;
      return false;
    });
    for (const card of setCards) {
      const idx = target.properties.indexOf(card);
      if (idx !== -1) {
        target.properties.splice(idx, 1);
        from.properties.push(card);
      }
    }
  }
}

function resolveAction(state: any) {
  state.pendingAction = null;
  state.phase = 'play';
}

async function saveState(supabase: any, gameId: string, state: any) {
  await supabase.from("games").update({
    game_state_json: state,
    current_player: state.currentPlayer,
  }).eq("id", gameId);
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
