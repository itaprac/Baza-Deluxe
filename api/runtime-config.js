module.exports = (req, res) => {
  const supabaseUrl =
    process.env.BAZUNIA_SUPABASE_URL ||
    process.env.BAZA_SUPABASE_URL ||
    '';
  const supabaseAnonKey =
    process.env.BAZUNIA_SUPABASE_ANON_KEY ||
    process.env.BAZA_SUPABASE_ANON_KEY ||
    '';

  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  res.status(200).send(
    `window.__BAZUNIA_SUPABASE_URL=${JSON.stringify(supabaseUrl)};
window.__BAZUNIA_SUPABASE_ANON_KEY=${JSON.stringify(supabaseAnonKey)};`
  );
};
