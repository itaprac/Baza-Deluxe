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
