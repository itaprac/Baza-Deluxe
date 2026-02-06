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
