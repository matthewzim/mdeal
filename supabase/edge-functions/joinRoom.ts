// Edge Function: joinRoom
// Joins an existing room using a room code

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { username, roomCode } = await req.json();

    if (!username || !roomCode) {
      return new Response(
        JSON.stringify({ error: "Username and room code required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Auth
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");
    if (!token) {
      return new Response(
        JSON.stringify({ error: "Auth required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid auth token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const playerId = user.id;

    // Upsert player
    await supabase.from("players").upsert({
      id: playerId,
      username: username.trim(),
    });

    // Find room
    const { data: room, error: roomError } = await supabase
      .from("rooms")
      .select("*")
      .eq("room_code", roomCode.toUpperCase())
      .single();

    if (roomError || !room) {
      return new Response(
        JSON.stringify({ error: "Room not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (room.status !== "waiting") {
      return new Response(
        JSON.stringify({ error: "Game already in progress" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check player count
    const { data: existingPlayers } = await supabase
      .from("room_players")
      .select("*")
      .eq("room_id", room.id);

    if (!existingPlayers) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch room players" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if already in room
    const alreadyIn = existingPlayers.find((rp: any) => rp.player_id === playerId);
    if (alreadyIn) {
      return new Response(
        JSON.stringify({
          roomId: room.id,
          roomCode: room.room_code,
          playerId,
          seatPosition: alreadyIn.seat_position,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (existingPlayers.length >= 5) {
      return new Response(
        JSON.stringify({ error: "Room is full (max 5 players)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Find next seat
    const takenSeats = existingPlayers.map((rp: any) => rp.seat_position);
    let nextSeat = 0;
    while (takenSeats.includes(nextSeat)) nextSeat++;

    // Add player
    const { error: insertError } = await supabase
      .from("room_players")
      .insert({
        room_id: room.id,
        player_id: playerId,
        seat_position: nextSeat,
        ready_status: false,
      });

    if (insertError) {
      return new Response(
        JSON.stringify({ error: "Failed to join room", details: insertError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        roomId: room.id,
        roomCode: room.room_code,
        playerId,
        seatPosition: nextSeat,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
