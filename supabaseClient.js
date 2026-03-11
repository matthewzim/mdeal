// Supabase Client Wrapper
// Handles connection, auth, realtime subscriptions, and edge function calls

const SupabaseClient = (() => {
  // ══════════════════════════════════════════════════════════════════════
  // CONFIGURATION — Update these with your Supabase project credentials
  // ══════════════════════════════════════════════════════════════════════
  let SUPABASE_URL = '';
  let SUPABASE_ANON_KEY = '';
  let supabase = null;
  let currentUser = null;
  let subscriptions = [];

  function init(url, anonKey) {
    SUPABASE_URL = url;
    SUPABASE_ANON_KEY = anonKey;
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

    // If the token is expired or about to expire (within 30s), refresh it
    const expiresAt = session.expires_at; // Unix timestamp in seconds
    const now = Math.floor(Date.now() / 1000);
    if (expiresAt && expiresAt - now < 30) {
      const { data: { session: refreshed } } = await supabase.auth.refreshSession();
      return refreshed?.access_token;
    }

    return session.access_token;
  }

  // ── Edge Function calls ──────────────────────────────────────────────

  async function callFunction(name, body) {
    const token = await getToken();
    if (!token) {
      throw new Error('Not authenticated. Please refresh and try again.');
    }

    // Use fetch directly instead of supabase.functions.invoke() so we have
    // full control over response parsing and can surface real error messages
    // instead of the generic "Edge Function returned a non-2xx status code".
    const url = SUPABASE_URL + '/functions/v1/' + name;
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token,
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

  async function createRoom(username) {
    return callFunction('createRoom', { username });
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

  return {
    init, getClient, signInAnonymously, getSession, getUser, getToken,
    createRoom, joinRoom, startGame, playCard, endTurn, respondAction,
    setReady, getRoomByCode, getRoomPlayers, getGame, getPlayerName,
    subscribeToRoom, subscribeToGame, unsubscribeAll,
  };
})();
