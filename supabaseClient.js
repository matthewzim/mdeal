// Supabase Client Wrapper
// Handles connection, auth, realtime subscriptions, and edge function calls

const SupabaseClient = (() => {
  // ══════════════════════════════════════════════════════════════════════
  // CONFIGURATION
  // ══════════════════════════════════════════════════════════════════════
  const SUPABASE_URL = 'https://jonhtpjyllblmraocfvc.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impvbmh0cGp5bGxibG1yYW9jZnZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxNzc1NzEsImV4cCI6MjA4ODc1MzU3MX0.Z2FFWB-NDDEs9oj32uORA3wjv1ZNzfYCNmahb4ZTm30';
  let supabase = null;
  let currentUser = null;
  let subscriptions = [];

  function init() {
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return supabase;
  }

  function getClient() {
    return supabase;
  }

  // ── Auth ──────────────────────────────────────────────────────────────

  async function signInAnonymously() {
    // Try anonymous sign-in first
    const { data, error } = await supabase.auth.signInAnonymously();
    if (!error) {
      currentUser = data.user;
      return data;
    }

    // If anonymous sign-ins are disabled, fall back to auto-generated account
    const storedId = localStorage.getItem('mdeal_auto_user_id');
    if (storedId) {
      // Try to sign in with existing auto-generated credentials
      const email = `${storedId}@mdeal.local`;
      const password = storedId;
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (!signInError) {
        currentUser = signInData.user;
        return signInData;
      }
    }

    // Create a new auto-generated account
    const userId = crypto.randomUUID();
    const email = `${userId}@mdeal.local`;
    const password = userId;
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({ email, password });
    if (signUpError) throw signUpError;
    localStorage.setItem('mdeal_auto_user_id', userId);
    currentUser = signUpData.user;
    return signUpData;
  }

  async function getSession() {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      currentUser = session.user;
    }
    return session;
  }

  function getUser() {
    return currentUser;
  }

  async function getToken() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;

    // If the token is expired or about to expire (within 60s), refresh it.
    // Also refresh when expires_at is missing to avoid sending a stale JWT.
    const expiresAt = session.expires_at; // Unix timestamp in seconds
    const now = Math.floor(Date.now() / 1000);
    if (!expiresAt || expiresAt - now < 60) {
      const { data: { session: refreshed } } = await supabase.auth.refreshSession();
      if (refreshed?.access_token) {
        return refreshed.access_token;
      }

      // Refresh failed (e.g. refresh token also expired). Re-authenticate.
      try {
        await signInAnonymously();
        const { data: { session: newSession } } = await supabase.auth.getSession();
        return newSession?.access_token || null;
      } catch (_e) {
        return null;
      }
    }

    return session.access_token;
  }

  // ── Edge Function calls ──────────────────────────────────────────────

  async function callFunction(name, body) {
    // Use fetch directly instead of supabase.functions.invoke() so we have
    // full control over response parsing and can surface real error messages
    // instead of the generic "Edge Function returned a non-2xx status code".
    async function attempt(authToken) {
      const url = SUPABASE_URL + '/functions/v1/' + name;
      let res;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + authToken,
            'apikey': SUPABASE_ANON_KEY,
          },
          body: JSON.stringify(body),
        });
      } catch (fetchErr) {
        throw new Error(
          'Could not reach the Edge Function "' + name + '". ' +
          'Make sure the function is deployed (supabase functions deploy ' + name + ').'
        );
      }
      return res;
    }

    let token = await getToken();
    if (!token) {
      throw new Error('Not authenticated. Please refresh and try again.');
    }

    let res = await attempt(token);

    // If we get a 401 (e.g. "Invalid JWT" from the API gateway due to an
    // expired or stale cached token), force a session refresh and retry once.
    if (res.status === 401) {
      const { data: { session: refreshed } } = await supabase.auth.refreshSession();
      if (refreshed?.access_token) {
        token = refreshed.access_token;
      } else {
        // Refresh failed — re-authenticate from scratch
        try {
          await signInAnonymously();
          const { data: { session: newSession } } = await supabase.auth.getSession();
          token = newSession?.access_token || null;
        } catch (_e) {
          token = null;
        }
      }

      if (!token) {
        throw new Error('Not authenticated. Please refresh and try again.');
      }

      res = await attempt(token);
    }

    let data;
    try {
      data = await res.json();
    } catch (e) {
      if (!res.ok) {
        throw new Error('Edge Function "' + name + '" returned status ' + res.status);
      }
      return null;
    }

    if (!res.ok) {
      throw new Error(data.error || data.message || 'Edge Function "' + name + '" returned status ' + res.status);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }

  async function createRoom(username, isPublic) {
    return callFunction('createRoom', { username, isPublic: !!isPublic });
  }

  async function joinRoom(username, roomCode) {
    return callFunction('joinRoom', { username, roomCode });
  }

  async function startGame(roomId) {
    return callFunction('startGame', { roomId });
  }

  async function playCard(gameId, action, params = {}) {
    return callFunction('playCard', { gameId, action, ...params });
  }

  async function endTurn(gameId, discardCardIds = null) {
    return callFunction('endTurn', { gameId, discardCardIds });
  }

  async function respondAction(gameId, response, params = {}) {
    return callFunction('respondAction', { gameId, response, ...params });
  }

  // ── Ready status ─────────────────────────────────────────────────────

  async function setReady(roomId, playerId, ready) {
    const { error } = await supabase
      .from('room_players')
      .update({ ready_status: ready })
      .eq('room_id', roomId)
      .eq('player_id', playerId);
    if (error) throw error;
  }

  // ── Data fetching ────────────────────────────────────────────────────

  async function getRoomByCode(roomCode) {
    const { data, error } = await supabase
      .from('rooms')
      .select('*')
      .eq('room_code', roomCode.toUpperCase())
      .single();
    if (error) throw error;
    return data;
  }

  async function getRoomPlayers(roomId) {
    const { data, error } = await supabase
      .from('room_players')
      .select(`
        *,
        players (username)
      `)
      .eq('room_id', roomId)
      .order('seat_position');
    if (error) throw error;
    return data;
  }

  async function getGame(roomId) {
    const { data, error } = await supabase
      .from('games')
      .select('*')
      .eq('room_id', roomId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    if (error) return null;
    return data;
  }

  async function getPlayerName(playerId) {
    const { data } = await supabase
      .from('players')
      .select('username')
      .eq('id', playerId)
      .single();
    return data?.username || 'Unknown';
  }

  // ── Public rooms ────────────────────────────────────────────────────

  async function getPublicRooms() {
    const { data: rooms, error } = await supabase
      .from('rooms')
      .select(`
        id,
        room_code,
        status,
        created_at,
        room_players (
          player_id,
          seat_position,
          players ( username )
        )
      `)
      .eq('is_public', true)
      .eq('status', 'waiting')
      .order('created_at', { ascending: false });
    if (error) throw error;
    // Filter out rooms that are already full (4 players)
    return (rooms || []).filter(r => (r.room_players || []).length < 4);
  }

  // ── Realtime ─────────────────────────────────────────────────────────

  function subscribeToRoom(roomId, onRoomChange) {
    const channel = supabase
      .channel('room_' + roomId)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'room_players', filter: `room_id=eq.${roomId}` },
        (payload) => onRoomChange(payload)
      )
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
        (payload) => onRoomChange(payload)
      )
      .subscribe();

    subscriptions.push(channel);
    return channel;
  }

  function subscribeToGame(gameId, onGameChange) {
    const channel = supabase
      .channel('game_' + gameId)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
        (payload) => onGameChange(payload)
      )
      .subscribe();

    subscriptions.push(channel);
    return channel;
  }

  function unsubscribeAll() {
    for (const channel of subscriptions) {
      supabase.removeChannel(channel);
    }
    subscriptions = [];
  }

  // ── Chat (Realtime Broadcast) ──────────────────────────────────────

  function subscribeToChatChannel(roomId, onMessage) {
    const channel = supabase
      .channel('chat_' + roomId)
      .on('broadcast', { event: 'chat_message' }, (payload) => {
        onMessage(payload.payload);
      })
      .subscribe();

    subscriptions.push(channel);
    return channel;
  }

  function sendChatMessage(roomId, message) {
    const channel = supabase.channel('chat_' + roomId);
    channel.send({
      type: 'broadcast',
      event: 'chat_message',
      payload: message,
    });
  }

  return {
    init, getClient, signInAnonymously, getSession, getUser, getToken,
    createRoom, joinRoom, startGame, playCard, endTurn, respondAction,
    setReady, getRoomByCode, getRoomPlayers, getGame, getPlayerName,
    getPublicRooms,
    subscribeToRoom, subscribeToGame, unsubscribeAll,
    subscribeToChatChannel, sendChatMessage,
  };
})();
