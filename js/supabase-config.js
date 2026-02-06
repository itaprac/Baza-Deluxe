// supabase-config.js — runtime configuration for Supabase

export const SUPABASE_URL = window.__BAZUNIA_SUPABASE_URL || window.__BAZA_SUPABASE_URL || '';
export const SUPABASE_ANON_KEY = window.__BAZUNIA_SUPABASE_ANON_KEY || window.__BAZA_SUPABASE_ANON_KEY || '';

export function isSupabaseConfigValid() {
  return (
    typeof SUPABASE_URL === 'string' &&
    typeof SUPABASE_ANON_KEY === 'string' &&
    SUPABASE_URL.length > 0 &&
    SUPABASE_ANON_KEY.length > 0 &&
    !SUPABASE_URL.includes('YOUR_SUPABASE_URL') &&
    !SUPABASE_ANON_KEY.includes('YOUR_SUPABASE_ANON_KEY')
  );
}
