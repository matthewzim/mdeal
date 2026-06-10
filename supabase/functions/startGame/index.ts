// Edge Function: startGame
// Initializes the game when all players are ready

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, publicView } from "../_shared/engine.ts";

// ── Inline game engine (Deno-compatible) ───────────────────────────────
// We inline the core deck/engine logic since Deno edge functions can't
// require() Node modules directly. In production you'd bundle these.

const COLORS: Record<string, string> = {
  BROWN: 'brown', DARK_BLUE: 'darkblue', LIGHT_BLUE: 'lightblue',
  PINK: 'pink', ORANGE: 'orange', RED: 'red', YELLOW: 'yellow',
  GREEN: 'green', RAILROAD: 'railroad', UTILITY: 'utility',
};

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

let _cid = 0;
function nid() { return 'card_' + (++_cid); }

function shuffleDeck(deck: any[]) {
  const arr = [...deck];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildFullDeck() {
  _cid = 0;
  const d: any[] = [];
  const prop = (color: string, name: string, value: number) =>
    ({ id: nid(), type: 'property', color, name, value });
  const wild = (colors: string[], name: string, value: number) =>
    ({ id: nid(), type: 'wild_property', colors, name, value, currentColor: colors[0] });
  const money = (value: number) =>
    ({ id: nid(), type: 'money', name: value + 'M', value });
  const action = (actionType: string, name: string, value: number) =>
    ({ id: nid(), type: 'action', actionType, name, value });
  const rent = (colors: string[], value: number) => {
    const cn = colors.map((c: string) => c.charAt(0).toUpperCase() + c.slice(1)).join('/');
    return { id: nid(), type: 'action', actionType: 'rent', rentColors: colors, name: 'Rent: ' + cn, value };
  };
  const multiRent = (value: number) =>
    ({ id: nid(), type: 'action', actionType: 'multi_rent', name: 'Multi Rent (Wild)', value });

  // Properties
  d.push(prop('brown','Mediterranean Ave',1), prop('brown','Baltic Ave',1));
  d.push(prop('darkblue','Park Place',4), prop('darkblue','Boardwalk',4));
  d.push(prop('lightblue','Oriental Ave',1), prop('lightblue','Vermont Ave',1), prop('lightblue','Connecticut Ave',1));
  d.push(prop('pink','St. Charles Place',2), prop('pink','Virginia Ave',2), prop('pink','States Ave',2));
  d.push(prop('orange','St. James Place',2), prop('orange','Tennessee Ave',2), prop('orange','New York Ave',2));
  d.push(prop('red','Kentucky Ave',3), prop('red','Indiana Ave',3), prop('red','Illinois Ave',3));
  d.push(prop('yellow','Atlantic Ave',3), prop('yellow','Ventnor Ave',3), prop('yellow','Marvin Gardens',3));
  d.push(prop('green','Pacific Ave',4), prop('green','North Carolina Ave',4), prop('green','Pennsylvania Ave',4));
  d.push(prop('railroad','Reading Railroad',2), prop('railroad','Pennsylvania Railroad',2),
         prop('railroad','B&O Railroad',2), prop('railroad','Short Line',2));
  d.push(prop('utility','Electric Company',2), prop('utility','Water Works',2));

  // Wild properties
  d.push(wild(['brown','lightblue'],'Wild: Brown/Light Blue',1));
  d.push(wild(['darkblue','green'],'Wild: Dark Blue/Green',4));
  d.push(wild(['lightblue','railroad'],'Wild: Light Blue/Railroad',4));
  d.push(wild(['pink','orange'],'Wild: Pink/Orange',2));
  d.push(wild(['railroad','utility'],'Wild: Railroad/Utility',2));
  d.push(wild(['railroad','green'],'Wild: Railroad/Green',4));
  d.push(wild(['red','yellow'],'Wild: Red/Yellow',3));
  d.push(wild(['red','yellow'],'Wild: Red/Yellow',3));
  d.push(wild(['all'],'Wild Property',0));
  d.push(wild(['all'],'Wild Property',0));

  // Money
  for (let i=0;i<6;i++) d.push(money(1));
  for (let i=0;i<5;i++) d.push(money(2));
  for (let i=0;i<3;i++) d.push(money(3));
  for (let i=0;i<3;i++) d.push(money(4));
  for (let i=0;i<2;i++) d.push(money(5));
  d.push(money(10));

  // Actions
  for (let i=0;i<10;i++) d.push(action('pass_go','Pass Go',1));
  for (let i=0;i<3;i++) d.push(action('debt_collector','Debt Collector',3));
  for (let i=0;i<3;i++) d.push(action('birthday',"It's My Birthday",2));
  for (let i=0;i<2;i++) d.push(action('double_rent','Double The Rent',1));
  for (let i=0;i<3;i++) d.push(action('sly_deal','Sly Deal',3));
  for (let i=0;i<4;i++) d.push(action('forced_deal','Forced Deal',3));
  for (let i=0;i<2;i++) d.push(action('deal_breaker','Deal Breaker',5));
  for (let i=0;i<3;i++) d.push(action('just_say_no','Just Say No',4));

  // Rent cards
  for (let i=0;i<2;i++) d.push(rent(['brown','lightblue'],1));
  for (let i=0;i<2;i++) d.push(rent(['pink','orange'],1));
  for (let i=0;i<2;i++) d.push(rent(['red','yellow'],1));
  for (let i=0;i<2;i++) d.push(rent(['darkblue','green'],1));
  for (let i=0;i<2;i++) d.push(rent(['railroad','utility'],1));
  for (let i=0;i<3;i++) d.push(multiRent(3));

  return d;
}

function buildNoMercyDeck() {
  _cid = 0;
  const d: any[] = [];
  const prop = (color: string, name: string, value: number) =>
    ({ id: nid(), type: 'property', color, name, value });
  const wild = (colors: string[], name: string, value: number) =>
    ({ id: nid(), type: 'wild_property', colors, name, value, currentColor: colors[0] });
  const money = (value: number) =>
    ({ id: nid(), type: 'money', name: value + 'M', value });
  const action = (actionType: string, name: string, value: number) =>
    ({ id: nid(), type: 'action', actionType, name, value });

  // Properties (same as regular)
  d.push(prop('brown','Mediterranean Ave',1), prop('brown','Baltic Ave',1));
  d.push(prop('darkblue','Park Place',4), prop('darkblue','Boardwalk',4));
  d.push(prop('lightblue','Oriental Ave',1), prop('lightblue','Vermont Ave',1), prop('lightblue','Connecticut Ave',1));
  d.push(prop('pink','St. Charles Place',2), prop('pink','Virginia Ave',2), prop('pink','States Ave',2));
  d.push(prop('orange','St. James Place',2), prop('orange','Tennessee Ave',2), prop('orange','New York Ave',2));
  d.push(prop('red','Kentucky Ave',3), prop('red','Indiana Ave',3), prop('red','Illinois Ave',3));
  d.push(prop('yellow','Atlantic Ave',3), prop('yellow','Ventnor Ave',3), prop('yellow','Marvin Gardens',3));
  d.push(prop('green','Pacific Ave',4), prop('green','North Carolina Ave',4), prop('green','Pennsylvania Ave',4));
  d.push(prop('railroad','Reading Railroad',2), prop('railroad','Pennsylvania Railroad',2),
         prop('railroad','B&O Railroad',2), prop('railroad','Short Line',2));
  d.push(prop('utility','Electric Company',2), prop('utility','Water Works',2));

  // Wild properties
  d.push(wild(['brown','lightblue'],'Wild: Brown/Light Blue',1));
  d.push(wild(['darkblue','green'],'Wild: Dark Blue/Green',4));
  d.push(wild(['lightblue','railroad'],'Wild: Light Blue/Railroad',4));
  d.push(wild(['pink','orange'],'Wild: Pink/Orange',2));
  d.push(wild(['railroad','utility'],'Wild: Railroad/Utility',2));
  d.push(wild(['railroad','green'],'Wild: Railroad/Green',4));
  d.push(wild(['red','yellow'],'Wild: Red/Yellow',3));
  d.push(wild(['red','yellow'],'Wild: Red/Yellow',3));
  d.push(wild(['all'],'Wild Property',0));
  d.push(wild(['all'],'Wild Property',0));

  // Money (No Mercy: no 3M, add 15M)
  for (let i=0;i<6;i++) d.push(money(1));
  for (let i=0;i<5;i++) d.push(money(2));
  for (let i=0;i<3;i++) d.push(money(4));
  for (let i=0;i<2;i++) d.push(money(5));
  d.push(money(10));
  d.push(money(15));

  // No Mercy Actions
  for (let i=0;i<8;i++) d.push(action('nm_pass_go','Pass Go',1));
  for (let i=0;i<6;i++) d.push(action('nm_rent','Rent',1));
  for (let i=0;i<3;i++) d.push(action('double_rent','Double The Rent',1));
  for (let i=0;i<3;i++) d.push(action('just_say_no','Just Say No',4));
  for (let i=0;i<3;i++) d.push(action('shack','Shack',3));
  for (let i=0;i<2;i++) d.push(action('super_sly_deal','Super Sly Deal',5));
  for (let i=0;i<2;i++) d.push(action('repossession','Repossession',4));
  for (let i=0;i<3;i++) d.push(action('tough_luck','Tough Luck',3));
  for (let i=0;i<3;i++) d.push(action('yoink','Yoink',4));
  for (let i=0;i<2;i++) d.push(action('unfair_trade','Unfair Trade',3));

  return d;
}

function createInitialState(playerIds: string[], gameMode: string = 'regular') {
  const deck = shuffleDeck(gameMode === 'nomercy' ? buildNoMercyDeck() : buildFullDeck());
  const players = playerIds.map(id => ({
    id, hand: [] as any[], bank: [] as any[], properties: [] as any[],
  }));

  const state: any = {
    deck, discardPile: [], players,
    currentPlayer: playerIds[0],
    turnPlaysRemaining: 3,
    phase: 'play',
    pendingAction: null,
    winner: null,
    log: [],
    turnDrawn: false,
    gameMode,
  };

  // Deal 5 cards each
  for (const player of state.players) {
    for (let i = 0; i < 5; i++) {
      if (state.deck.length > 0) player.hand.push(state.deck.pop());
    }
  }

  state.phase = 'draw';
  return state;
}
// ── End inline engine ──────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { roomId, gameMode } = await req.json();

    // Auth
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");
    if (!token) {
      return new Response(
        JSON.stringify({ error: "Auth required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) {
      return new Response(
        JSON.stringify({ error: "Invalid auth" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch room
    const { data: room } = await supabase
      .from("rooms")
      .select("*")
      .eq("id", roomId)
      .single();

    if (!room) {
      return new Response(
        JSON.stringify({ error: "Room not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (room.status !== "waiting") {
      return new Response(
        JSON.stringify({ error: "Game already started" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Only host can start
    if (room.host_id !== user.id) {
      return new Response(
        JSON.stringify({ error: "Only the host can start the game" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch room players
    const { data: roomPlayers } = await supabase
      .from("room_players")
      .select("*")
      .eq("room_id", roomId)
      .order("seat_position");

    if (!roomPlayers || roomPlayers.length < 2) {
      return new Response(
        JSON.stringify({ error: "Need at least 2 players" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check all ready
    const allReady = roomPlayers.every((rp: any) => rp.ready_status);
    if (!allReady) {
      return new Response(
        JSON.stringify({ error: "Not all players are ready" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create game state
    const playerIds = roomPlayers.map((rp: any) => rp.player_id);
    const gameState = createInitialState(playerIds, gameMode || 'regular');
    gameState.seq = 1;

    // Insert game: the games row holds only the public (fully redacted)
    // view that is safe to broadcast; the full state with deck order and
    // hands goes into game_states, which clients cannot read.
    const { data: game, error: gameError } = await supabase
      .from("games")
      .insert({
        room_id: roomId,
        game_state_json: publicView(gameState),
        current_player: gameState.currentPlayer,
      })
      .select()
      .single();

    if (gameError) {
      return new Response(
        JSON.stringify({ error: "Failed to create game", details: gameError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { error: stateError } = await supabase
      .from("game_states")
      .insert({
        game_id: game.id,
        state_json: gameState,
        version: 1,
      });

    if (stateError) {
      return new Response(
        JSON.stringify({ error: "Failed to create game state", details: stateError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update room status
    await supabase
      .from("rooms")
      .update({ status: "playing" })
      .eq("id", roomId);

    return new Response(
      JSON.stringify({ gameId: game.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
