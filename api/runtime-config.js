module.exports = (req, res) => {
  const supabaseUrl =
    process.env.BAZUNIA_SUPABASE_URL ||
    process.env.BAZA_SUPABASE_URL ||
    '';
  const supabaseAnonKey =
    process.env.BAZUNIA_SUPABASE_ANON_KEY ||
    process.env.BAZA_SUPABASE_ANON_KEY ||
    '';
  const publicDeckProviderRaw =
    process.env.BAZUNIA_PUBLIC_DECK_PROVIDER ||
    process.env.BAZA_PUBLIC_DECK_PROVIDER ||
    'static';
  const publicDeckProvider = String(publicDeckProviderRaw).toLowerCase() === 'supabase'
    ? 'supabase'
    : 'static';

  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  res.status(200).send(
    `window.__BAZUNIA_SUPABASE_URL=${JSON.stringify(supabaseUrl)};
window.__BAZUNIA_SUPABASE_ANON_KEY=${JSON.stringify(supabaseAnonKey)};
window.__BAZUNIA_PUBLIC_DECK_PROVIDER=${JSON.stringify(publicDeckProvider)};`
  );
};
