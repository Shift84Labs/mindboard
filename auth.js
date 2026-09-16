// Identity for MindBoard. OFF by default: AUTH_MODE=none behaves exactly as the app always has
// (one implicit local owner), so upgrades and fresh clones are unaffected.
//
//   none   every request is the built-in `local` user
//   proxy  trust an identity header from a reverse proxy, but only from AUTH_TRUSTED_PROXIES
//   oidc   authorization code + PKCE against any OIDC provider (Pocket ID, Authelia, Keycloak)
//
// Phase 1 only decides WHO you are: every signed-in user still shares one board. Per-user boards
// arrive with ownerId in phase 2.
const crypto = require('node:crypto');
const net = require('node:net');

const MODES = ['none', 'proxy', 'oidc'];
const LOCAL_USER = { id: 'local', email: null, displayName: 'Local', role: 'admin' };
const SESSION_DAYS = 7;

const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function readConfig(env) {
  const mode = env.AUTH_MODE || 'none';
  if (!MODES.includes(mode)) die(`AUTH_MODE must be one of ${MODES.join(', ')} (got "${mode}")`);
  const cfg = {
    mode,
    header: (env.AUTH_PROXY_HEADER || 'x-auth-request-email').toLowerCase(),
    trusted: list(env.AUTH_TRUSTED_PROXIES),
    allowedEmails: list(env.AUTH_ALLOWED_EMAILS).map((e) => e.toLowerCase()),
    allowedGroups: list(env.AUTH_ALLOWED_GROUPS),
    issuer: env.OIDC_ISSUER_URL || '',
    clientId: env.OIDC_CLIENT_ID || '',
    clientSecret: env.OIDC_CLIENT_SECRET || '',
    redirectUri: env.OIDC_REDIRECT_URI || '',
    scope: env.OIDC_SCOPE || 'openid email profile',
    sessionSecret: env.SESSION_SECRET || '',
    secureCookie: (env.SESSION_COOKIE_SECURE || 'true') !== 'false',
  };
  // a header is only evidence when the client cannot send it: with no CIDR list anyone could
  // claim to be anyone, so refuse to start rather than pretend to authenticate
  if (mode === 'proxy' && !cfg.trusted.length) {
    die('AUTH_MODE=proxy needs AUTH_TRUSTED_PROXIES (comma-separated CIDRs of the reverse proxy)');
  }
  if (mode === 'oidc') {
    const missing = [
      ['OIDC_ISSUER_URL', 'issuer'], ['OIDC_CLIENT_ID', 'clientId'], ['OIDC_CLIENT_SECRET', 'clientSecret'],
      ['OIDC_REDIRECT_URI', 'redirectUri'], ['SESSION_SECRET', 'sessionSecret'],
    ].filter(([, key]) => !cfg[key]).map(([name]) => name);
    if (missing.length) die(`AUTH_MODE=oidc needs ${missing.join(', ')}`);
  }
  return cfg;
}

// net.BlockList does CIDR matching in the standard library, IPv4 and IPv6 both
function blockList(cidrs) {
  const bl = new net.BlockList();
  for (const entry of cidrs) {
    const [addr, bits] = entry.split('/');
    if (!net.isIP(addr)) die(`AUTH_TRUSTED_PROXIES: "${entry}" is not an IP or CIDR`);
    const type = net.isIPv6(addr) ? 'ipv6' : 'ipv4';
    if (bits === undefined) bl.addAddress(addr, type);
    else bl.addSubnet(addr, Number(bits), type);
  }
  return bl;
}

const plainIp = (ip) => String(ip || '').replace(/^::ffff:/, '');

function fromTrustedProxy(req, trusted) {
  const ip = plainIp(req.socket.remoteAddress);
  if (!net.isIP(ip)) return false;
  return trusted.check(ip, net.isIPv6(ip) ? 'ipv6' : 'ipv4');
}

// openid-client v6 is ESM first, so it is imported only when OIDC is actually in use; that keeps
// this CommonJS app working on Node versions that cannot require() an ESM package
let oidcLib;
let oidcConfig;
const oidcModule = async () => (oidcLib ||= await import('openid-client'));
async function oidcDiscover(cfg) {
  const lib = await oidcModule();
  oidcConfig ||= await lib.discovery(new URL(cfg.issuer), cfg.clientId, cfg.clientSecret);
  return oidcConfig;
}

// authorizationCodeGrant has already validated the ID token, so reading its payload is safe
function idTokenClaims(tokens) {
  if (typeof tokens.claims === 'function') {
    const claims = tokens.claims();
    if (claims) return claims;
  }
  const payload = String(tokens.id_token || '').split('.')[1];
  return payload ? JSON.parse(Buffer.from(payload, 'base64url').toString()) : {};
}

function allowed(cfg, { email, groups }) {
  if (cfg.allowedEmails.length && !cfg.allowedEmails.includes(String(email || '').toLowerCase())) return false;
  if (cfg.allowedGroups.length && !cfg.allowedGroups.some((g) => (groups || []).includes(g))) return false;
  return true;
}

// A user's id owns their board, so an identity must never resolve to someone else's record.
// A proxy vouches for the email, so proxy users match by email. An OIDC user matches by subject;
// an email is only as good as the provider's word for it, so it can link an account the proxy
// created (no subject yet) only when the provider marks it verified.
function findUser(users, { subject, email, emailVerified }) {
  if (!subject) return users.find((u) => u.email === email);
  return users.find((u) => u.subject === subject)
    || (emailVerified === true && email ? users.find((u) => !u.subject && u.email === email) : undefined);
}

// the first user in is the admin
function upsertUser(store, { subject, email, emailVerified, displayName }) {
  const db = store.getDb();
  db.users = db.users || [];
  email = email ? String(email).toLowerCase() : null;
  const existing = findUser(db.users, { subject, email, emailVerified });
  if (existing) {
    if (subject && !existing.subject) {
      existing.subject = subject;
      store.save();
    }
    const name = displayName || existing.displayName;
    if (existing.email !== email || existing.displayName !== name) {
      existing.email = email || existing.email;
      existing.displayName = name;
      store.save();
    }
    return existing;
  }
  // random, never derived from the email or subject: a+b@x and a_b@x must not share a board
  const user = {
    id: crypto.randomUUID(),
    subject: subject || null,
    email: email || null,
    displayName: displayName || email || 'User',
    role: db.users.length ? 'user' : 'admin',
    createdAt: new Date().toISOString(),
  };
  db.users.push(user);
  store.save();
  return user;
}

const publicUser = (u) => ({ id: u.id, email: u.email, displayName: u.displayName, role: u.role });

function attach(app, store, env = process.env) {
  const cfg = readConfig(env);
  const trusted = blockList(cfg.trusted);

  // browsers attach Origin to state-changing requests, so a mismatch means another site is driving
  // it. JSON writes are already covered by the CORS preflight, but the multipart upload is a
  // "simple" request and would otherwise be reachable cross-site.
  app.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const origin = req.headers.origin;
    if (!origin) return next();
    let host;
    try { host = new URL(origin).host; } catch { host = null; }
    if (host !== req.headers.host) return res.status(403).json({ error: 'Cross-origin request refused' });
    next();
  });

  // never behind auth: monitoring must be able to tell "up" from "not signed in"
  app.get('/healthz', (req, res) => res.json({ status: 'ok', auth: cfg.mode }));

  function identify(req) {
    if (cfg.mode === 'none') return LOCAL_USER;
    if (cfg.mode === 'proxy') {
      if (!fromTrustedProxy(req, trusted)) return null;
      const value = req.headers[cfg.header];
      if (!value) return null;
      const email = String(value).toLowerCase();
      if (!allowed(cfg, { email, groups: [] })) return null;
      return publicUser(upsertUser(store, { subject: null, email, displayName: email }));
    }
    return req.session && req.session.user ? req.session.user : null;
  }

  if (cfg.mode === 'oidc') {
    const cookieSession = require('cookie-session');
    app.use(cookieSession({
      name: 'mb_session',
      keys: [cfg.sessionSecret],
      maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: 'lax',
      secure: cfg.secureCookie,
    }));

    app.get('/auth/login', async (req, res) => {
      try {
        const lib = await oidcModule();
        const config = await oidcDiscover(cfg);
        const verifier = lib.randomPKCECodeVerifier();
        const state = lib.randomState();
        req.session.pkce = { verifier, state };
        const url = lib.buildAuthorizationUrl(config, {
          redirect_uri: cfg.redirectUri,
          scope: cfg.scope,
          code_challenge: await lib.calculatePKCECodeChallenge(verifier),
          code_challenge_method: 'S256',
          state,
        });
        res.redirect(url.href);
      } catch (e) {
        console.error(`OIDC login failed: ${e.message}`);
        res.status(502).json({ error: 'Login unavailable' });
      }
    });

    app.get('/auth/callback', async (req, res) => {
      const pkce = req.session && req.session.pkce;
      if (!pkce) return res.status(400).json({ error: 'No login in progress' });
      try {
        const lib = await oidcModule();
        const config = await oidcDiscover(cfg);
        const current = new URL(cfg.redirectUri);
        current.search = new URL(req.originalUrl, cfg.redirectUri).search;
        const tokens = await lib.authorizationCodeGrant(config, current, {
          pkceCodeVerifier: pkce.verifier,
          expectedState: pkce.state,
        });
        const claims = idTokenClaims(tokens);
        if (!allowed(cfg, { email: claims.email, groups: claims.groups })) {
          console.error(`OIDC login rejected for ${claims.sub}: not in the allowlist`);
          req.session = null;
          return res.status(403).json({ error: 'Not allowed' });
        }
        req.session.pkce = null;
        req.session.user = publicUser(upsertUser(store, {
          subject: claims.sub,
          email: claims.email,
          emailVerified: claims.email_verified,
          displayName: claims.name || claims.preferred_username,
        }));
        res.redirect('/');
      } catch (e) {
        console.error(`OIDC callback failed: ${e.message}`);
        req.session = null;
        res.status(400).json({ error: 'Login failed' });
      }
    });

    const signOut = (req, res) => {
      req.session = null;
      res.redirect('/');
    };
    app.get('/auth/logout', signOut);
    app.post('/auth/logout', signOut);
  }

  // reachable signed out on purpose: the UI asks this to find out whether it must log in
  app.get('/api/me', (req, res) => {
    const user = identify(req);
    res.json({ mode: cfg.mode, authenticated: !!user, user: user || null });
  });

  app.use((req, res, next) => {
    const user = identify(req);
    if (user) {
      req.user = user;
      return next();
    }
    const wantsHtml = req.method === 'GET' && String(req.headers.accept || '').includes('text/html');
    if (cfg.mode === 'oidc' && wantsHtml) return res.redirect('/auth/login');
    res.status(401).json({ error: 'Not signed in' });
  });

  return cfg;
}

module.exports = { attach, readConfig, upsertUser, LOCAL_USER };
