import * as client from "openid-client";
import { Strategy, type VerifyFunction } from "openid-client/passport";

import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import memoize from "memoizee";
import connectPgSimple from "connect-pg-simple";
import { authStorage } from "./storage";

// Create PG session store class at module scope
const PgSession = connectPgSimple(session);

const getOidcConfig = memoize(
  async () => {
    return await client.discovery(
      new URL(process.env.ISSUER_URL ?? "https://replit.com/oidc"),
      process.env.REPL_ID!
    );
  },
  { maxAge: 3600 * 1000 }
);

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  
  // Use PostgreSQL session store in production to support autoscale
  // In development or if no DATABASE_URL, fall back to in-memory
  // In production, prefer PROD_DATABASE_URL over DATABASE_URL
  const isProduction = process.env.NODE_ENV === "production";
  const databaseUrl = (isProduction && process.env.PROD_DATABASE_URL)
    ? process.env.PROD_DATABASE_URL
    : process.env.DATABASE_URL;
  
  // Check if this is a dev/internal database URL that won't work in production
  // helium, lithium, etc. are internal Replit hosts that don't exist outside dev
  // NOTE: Only check databaseUrl, NOT PGHOST - PGHOST always points to dev database
  const isDevDatabase = 
    databaseUrl?.includes("helium") || 
    databaseUrl?.includes("lithium") ||
    false;
  
  console.log("[Auth] Database check - isProduction:", isProduction, "isDevDatabase:", isDevDatabase, "databaseUrl host:", databaseUrl?.split("@")[1]?.split("/")[0] || "none");
  
  let store: session.Store | undefined;
  
  // Only use PG session store in production with a PRODUCTION database
  // Don't use dev database URL (helium) in production - it won't work
  if (databaseUrl && isProduction && !isDevDatabase) {
    try {
      store = new PgSession({
        conString: databaseUrl,
        tableName: "user_sessions",
        createTableIfMissing: true,
        ttl: sessionTtl / 1000, // TTL in seconds
        pruneSessionInterval: 60 * 15, // Clean up every 15 minutes
      });
      console.log("[Auth] Using PostgreSQL session store for production");
    } catch (err) {
      console.error("[Auth] Failed to create PG session store, using in-memory:", err);
    }
  }
  
  if (!store) {
    // Use PostgreSQL session store for both production and development when database is available
    // This prevents session loss on server restarts in development
    if (databaseUrl) {
      console.log("[Auth] Attempting PostgreSQL session store for persistent sessions");
      try {
        store = new PgSession({
          conString: databaseUrl,
          tableName: "user_sessions",
          createTableIfMissing: true,
          ttl: sessionTtl / 1000,
          pruneSessionInterval: 60 * 15,
        });
        console.log("[Auth] Using PostgreSQL session store (sessions persist across restarts)");
      } catch (err) {
        console.log("[Auth] PG session store failed, using in-memory:", err);
        console.log("[Auth] WARNING: Sessions won't persist across server restarts");
      }
    } else {
      console.log("[Auth] Using in-memory session store (no database URL available)");
    }
  }
  
  return session({
    store,
    secret: process.env.SESSION_SECRET || "talkhint-session-secret-key-2024",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" as const : "lax" as const,
      maxAge: sessionTtl,
    },
  });
}

function updateUserSession(
  user: any,
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers
) {
  user.claims = tokens.claims();
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  user.expires_at = user.claims?.exp;
}

async function upsertUser(claims: any) {
  await authStorage.upsertUser({
    id: claims["sub"],
    email: claims["email"],
    firstName: claims["first_name"],
    lastName: claims["last_name"],
    profileImageUrl: claims["profile_image_url"],
  });
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  const config = await getOidcConfig();

  const verify: VerifyFunction = async (
    tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
    verified: passport.AuthenticateCallback
  ) => {
    const user = {};
    updateUserSession(user, tokens);
    await upsertUser(tokens.claims());
    verified(null, user);
  };

  // Keep track of registered strategies
  const registeredStrategies = new Set<string>();

  // Helper function to ensure strategy exists for a domain
  const ensureStrategy = (domain: string) => {
    const strategyName = `replitauth:${domain}`;
    if (!registeredStrategies.has(strategyName)) {
      const strategy = new Strategy(
        {
          name: strategyName,
          config,
          scope: "openid email profile offline_access",
          callbackURL: `https://${domain}/api/callback`,
        },
        verify
      );
      passport.use(strategy);
      registeredStrategies.add(strategyName);
    }
  };

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));

  app.get("/api/login", (req, res, next) => {
    ensureStrategy(req.hostname);
    passport.authenticate(`replitauth:${req.hostname}`, {
      prompt: "login consent",
      scope: ["openid", "email", "profile", "offline_access"],
    })(req, res, next);
  });

  app.get("/api/callback", (req, res, next) => {
    ensureStrategy(req.hostname);
    passport.authenticate(`replitauth:${req.hostname}`, async (err: any, user: any) => {
      if (err || !user) {
        console.error("[OAuth] Auth failed:", err);
        return res.redirect("/?error=auth_failed");
      }
      
      req.login(user, async (loginErr) => {
        if (loginErr) {
          console.error("[OAuth] Login failed:", loginErr);
          return res.redirect("/?error=login_failed");
        }
        
        try {
          const { createSession } = await import("../../auth");
          const { authStorage } = await import("./storage");
          
          const claims = user.claims ? user.claims : user;
          const userId = claims.sub || claims.id || user.id;
          
          if (!userId) {
            console.error("[OAuth] No user ID found");
            return res.redirect("/?error=no_user_id");
          }
          
          const dbUser = await authStorage.getUser(userId);
          if (!dbUser) {
            console.error("[OAuth] User not found in storage:", userId);
            return res.redirect("/?error=user_not_found");
          }
          
          const token = await createSession(dbUser.id);
          console.log("[OAuth] Created session token for user:", dbUser.id);
          
          res.redirect(`/?token=${token}`);
        } catch (error) {
          console.error("[OAuth] Token creation failed:", error);
          res.redirect("/?error=token_failed");
        }
      });
    })(req, res, next);
  });

  app.get("/api/logout", (req, res) => {
    req.logout(() => {
      res.redirect(
        client.buildEndSessionUrl(config, {
          client_id: process.env.REPL_ID!,
          post_logout_redirect_uri: `${req.protocol}://${req.hostname}`,
        }).href
      );
    });
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const user = req.user as any;

  if (!req.isAuthenticated() || !user.expires_at) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const now = Math.floor(Date.now() / 1000);
  if (now <= user.expires_at) {
    return next();
  }

  const refreshToken = user.refresh_token;
  if (!refreshToken) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  try {
    const config = await getOidcConfig();
    const tokenResponse = await client.refreshTokenGrant(config, refreshToken);
    updateUserSession(user, tokenResponse);
    return next();
  } catch (error) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
};
