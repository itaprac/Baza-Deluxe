// supabase.js — Supabase client, auth helpers, and storage persistence helpers

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, isSupabaseConfigValid } from './supabase-config.js';

let supabase = null;

export function isSupabaseConfigured() {
  return isSupabaseConfigValid();
}

export function getSupabaseClient() {
  if (!isSupabaseConfigured()) {
    return null;
  }

  if (!supabase) {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    });
  }

  return supabase;
}

function ensureClient() {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Brak konfiguracji Supabase. Ustaw BAZUNIA_SUPABASE_URL i BAZUNIA_SUPABASE_ANON_KEY (np. w .env).');
  }
  return client;
}

export async function getCurrentSession() {
  const client = ensureClient();
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  return data.session;
}

export function onAuthStateChange(callback) {
  const client = ensureClient();
  const {
    data: { subscription },
  } = client.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
  return subscription;
}

export async function signInWithPassword(email, password) {
  const client = ensureClient();
  return client.auth.signInWithPassword({ email, password });
}

export async function signUpWithPassword(email, password) {
  const client = ensureClient();
  return client.auth.signUp({ email, password });
}

export async function signInWithGoogle() {
  const client = ensureClient();
  return client.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/`,
    },
  });
}

export async function signOutUser() {
  const client = ensureClient();
  return client.auth.signOut();
}

export async function sendPasswordResetEmail(email) {
  const client = ensureClient();
  return client.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/`,
  });
}

// --- Role and admin RPC ---

export async function fetchCurrentUserRole() {
  const client = ensureClient();
  const { data, error } = await client.rpc('current_app_role');
  if (error) throw error;
  return typeof data === 'string' ? data : 'user';
}

export async function fetchAdminUsers() {
  const client = ensureClient();
  const { data, error } = await client.rpc('admin_list_users');
  if (error) throw error;
  return data || [];
}

export async function setUserRole(targetUserId, nextRole) {
  const client = ensureClient();
  const { error } = await client.rpc('admin_set_user_role', {
    target_user_id: targetUserId,
    next_role: nextRole,
  });
  if (error) throw error;
}

// --- Global public decks ---

const PUBLIC_DECK_COLUMNS = [
  'id',
  'name',
  'description',
  'deck_group',
  'categories',
  'questions',
  'question_count',
  'version',
  'source',
  'is_archived',
  'updated_by',
  'created_at',
  'updated_at',
].join(',');

const USER_PROFILE_COLUMNS = [
  'user_id',
  'username',
  'created_at',
  'updated_at',
].join(',');

const SHARED_DECK_COLUMNS = [
  'id',
  'owner_user_id',
  'owner_username',
  'source_deck_id',
  'name',
  'description',
  'deck_group',
  'categories',
  'questions',
  'question_count',
  'is_published',
  'created_at',
  'updated_at',
].join(',');

export async function fetchPublicDecks(options = {}) {
  const includeArchived = options.includeArchived === true;
  const client = ensureClient();

  let query = client
    .from('public_decks')
    .select(PUBLIC_DECK_COLUMNS)
    .order('name', { ascending: true });

  if (!includeArchived) {
    query = query.eq('is_archived', false);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function upsertPublicDeck(deckPayload) {
  const client = ensureClient();
  const { data, error } = await client
    .from('public_decks')
    .upsert(deckPayload, { onConflict: 'id' })
    .select(PUBLIC_DECK_COLUMNS)
    .single();

  if (error) throw error;
  return data;
}

export async function archivePublicDeck(deckId) {
  const client = ensureClient();
  const { error } = await client
    .from('public_decks')
    .update({ is_archived: true })
    .eq('id', deckId);

  if (error) throw error;
}

export async function restorePublicDeck(deckId) {
  const client = ensureClient();
  const { error } = await client
    .from('public_decks')
    .update({ is_archived: false })
    .eq('id', deckId);

  if (error) throw error;
}

export async function hidePublicDeck(deckId) {
  return archivePublicDeck(deckId);
}

export async function unhidePublicDeck(deckId) {
  return restorePublicDeck(deckId);
}

// --- User profile (username) ---

export async function fetchMyProfile() {
  const client = ensureClient();
  const {
    data: { user },
    error: authError,
  } = await client.auth.getUser();
  if (authError) throw authError;
  if (!user) throw new Error('Brak aktywnego użytkownika.');

  const { data, error } = await client
    .from('user_profiles')
    .select(USER_PROFILE_COLUMNS)
    .eq('user_id', user.id)
    .single();

  if (error) throw error;
  return data;
}

export async function updateMyUsername(username) {
  const normalized = String(username || '').trim().toLowerCase();
  const client = ensureClient();
  const {
    data: { user },
    error: authError,
  } = await client.auth.getUser();
  if (authError) throw authError;
  if (!user) throw new Error('Brak aktywnego użytkownika.');

  const { data, error } = await client
    .from('user_profiles')
    .update({ username: normalized })
    .eq('user_id', user.id)
    .select(USER_PROFILE_COLUMNS)
    .single();

  if (error) throw error;
  return data;
}

// --- Shared decks catalog and subscriptions ---

function escapeLikeQuery(value) {
  return String(value || '').replace(/[,%_]/g, ' ');
}

export async function searchSharedDecks(options = {}) {
  const client = ensureClient();
  const query = String(options.query || '').trim();
  const pageSize = Math.max(1, Number(options.pageSize) || 20);
  const page = Math.max(1, Number(options.page) || 1);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let request = client
    .from('shared_decks')
    .select(SHARED_DECK_COLUMNS, { count: 'exact' })
    .eq('is_published', true)
    .order('updated_at', { ascending: false })
    .range(from, to);

  if (query) {
    const needle = `%${escapeLikeQuery(query)}%`;
    request = request.or(`name.ilike.${needle},description.ilike.${needle}`);
  }

  const { data, error, count } = await request;
  if (error) throw error;
  const total = Number.isFinite(count) ? count : (data || []).length;
  return {
    items: data || [],
    total,
    page,
    pageSize,
  };
}

export async function publishSharedDeck(deckPayload) {
  const client = ensureClient();
  const {
    data: { user },
    error: authError,
  } = await client.auth.getUser();
  if (authError) throw authError;
  if (!user) throw new Error('Brak aktywnego użytkownika.');

  const payload = {
    ...deckPayload,
    owner_user_id: user.id,
    is_published: true,
  };

  const { data, error } = await client
    .from('shared_decks')
    .upsert(payload, { onConflict: 'owner_user_id,source_deck_id' })
    .select(SHARED_DECK_COLUMNS)
    .single();

  if (error) throw error;
  return data;
}

export async function unpublishSharedDeck(sharedDeckId) {
  const client = ensureClient();
  const {
    data: { user },
    error: authError,
  } = await client.auth.getUser();
  if (authError) throw authError;
  if (!user) throw new Error('Brak aktywnego użytkownika.');

  const { data, error } = await client
    .from('shared_decks')
    .update({ is_published: false })
    .eq('id', sharedDeckId)
    .eq('owner_user_id', user.id)
    .select(SHARED_DECK_COLUMNS)
    .single();

  if (error) throw error;
  return data;
}

export async function fetchMySubscriptions() {
  const client = ensureClient();
  const { data, error } = await client
    .from('shared_deck_subscriptions')
    .select(`
      user_id,
      shared_deck_id,
      created_at,
      shared_decks (${SHARED_DECK_COLUMNS})
    `)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function subscribeToSharedDeck(sharedDeckId) {
  const client = ensureClient();
  const {
    data: { user },
    error: authError,
  } = await client.auth.getUser();
  if (authError) throw authError;
  if (!user) throw new Error('Brak aktywnego użytkownika.');

  const { data, error } = await client
    .from('shared_deck_subscriptions')
    .upsert(
      {
        user_id: user.id,
        shared_deck_id: sharedDeckId,
      },
      { onConflict: 'user_id,shared_deck_id' }
    )
    .select('user_id,shared_deck_id,created_at')
    .single();

  if (error) throw error;
  return data;
}

export async function unsubscribeFromSharedDeck(sharedDeckId) {
  const client = ensureClient();
  const {
    data: { user },
    error: authError,
  } = await client.auth.getUser();
  if (authError) throw authError;
  if (!user) throw new Error('Brak aktywnego użytkownika.');

  const { error } = await client
    .from('shared_deck_subscriptions')
    .delete()
    .eq('user_id', user.id)
    .eq('shared_deck_id', sharedDeckId);

  if (error) throw error;
}

// --- User storage ---

export async function fetchAllUserStorage(userId) {
  const client = ensureClient();
  const { data, error } = await client
    .from('user_storage')
    .select('key, value')
    .eq('user_id', userId);

  if (error) throw error;
  return data || [];
}

export async function upsertUserStorage(userId, key, value) {
  const client = ensureClient();
  const { error } = await client
    .from('user_storage')
    .upsert(
      {
        user_id: userId,
        key,
        value,
      },
      { onConflict: 'user_id,key' }
    );

  if (error) throw error;
}

export async function deleteUserStorageKeys(userId, keys) {
  if (!Array.isArray(keys) || keys.length === 0) return;

  const client = ensureClient();
  const { error } = await client
    .from('user_storage')
    .delete()
    .eq('user_id', userId)
    .in('key', keys);

  if (error) throw error;
}
