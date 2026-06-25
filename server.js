require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs-extra");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
// optional Redis for sessions/cache
let Redis;
let RedisStore;

const app = express();
const DATA_DIR = path.join(__dirname, "data");
fs.ensureDirSync(DATA_DIR);

// environment flags and secrets
const isProd = process.env.NODE_ENV === "production";
const sessionSecret = process.env.SESSION_SECRET || "dev-secret";

// Use SQLite for data and sessions
const sqlite3 = require("sqlite3").verbose();
const SQLiteStore = require("connect-sqlite3")(session);
const DB_FILE = path.join(DATA_DIR, "db.sqlite");
const db = new sqlite3.Database(DB_FILE);

// create tables if not exist
db.serialize(() => {
  db.run(
    `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT, fullName TEXT, email TEXT, phone TEXT, passwordHash TEXT, role TEXT, created TEXT)`,
  );
  db.run(
    `CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY, type TEXT, amount REAL, method TEXT, status TEXT, created TEXT, updated TEXT)`,
  );
  // persistent failed login tracking for admin lockout
  db.run(
    `CREATE TABLE IF NOT EXISTS failed_logins (key TEXT PRIMARY KEY, count INTEGER, last INTEGER, blockedUntil INTEGER)`,
  );
});

// Basic security middlewares
app.use(helmet());

// Trust proxy when behind a reverse proxy (set in production)
if (isProd) app.set("trust proxy", 1);

// Tighten CORS: allow only configured origin in production or localhost while developing
const allowedOrigin = process.env.ALLOWED_ORIGIN || `http://localhost:3000`;
app.use(
  cors({
    origin: function (origin, callback) {
      // allow requests with no origin (mobile apps, curl)
      if (!origin) return callback(null, true);
      if (!isProd) return callback(null, true);
      if (origin === allowedOrigin) return callback(null, true);
      return callback(new Error("CORS not allowed"));
    },
    credentials: true,
  }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiter (basic global)
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
app.use(limiter);

// Admin-specific rate limiter (stricter)
// For login attempts we keep it very strict
const adminLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 6,
  message: { error: "Too many admin login attempts, try again later" },
});

// Session config using environment secret (sessionSecret and isProd declared earlier)
app.use(
  (function () {
    // Choose session store: Redis if REDIS_URL provided, otherwise SQLite file store
    let storeInstance = new SQLiteStore({
      db: "sessions.sqlite",
      dir: DATA_DIR,
    });
    if (process.env.REDIS_URL) {
      try {
        Redis = require("ioredis");
        RedisStore = require("connect-redis")(session);
        const redisClient = new Redis(process.env.REDIS_URL);
        storeInstance = new RedisStore({ client: redisClient });
        console.log("Using Redis session store");
      } catch (e) {
        console.warn(
          "REDIS_URL set but redis packages not installed or failed to load. Falling back to SQLite sessions.",
        );
      }
    }
    return session({
      store: storeInstance,
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: isProd, // require HTTPS in production
        httpOnly: true,
        sameSite: isProd ? "strict" : "lax",
        maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
      },
    });
  })(),
);

// optional cookie domain
if (process.env.COOKIE_DOMAIN) {
  app.set("cookie domain", process.env.COOKIE_DOMAIN);
}

// serve static files
app.use(express.static(path.join(__dirname)));

// helper to migrate old JSON files into DB if present
const USERS_FILE = path.join(DATA_DIR, "users.json");
const TX_FILE = path.join(DATA_DIR, "transactions.json");
function migrateJsonToDb() {
  if (fs.existsSync(USERS_FILE)) {
    try {
      const arr = fs.readJsonSync(USERS_FILE);
      const stmt = db.prepare(
        `INSERT OR IGNORE INTO users (id, username, fullName, email, phone, passwordHash, role, created) VALUES (?,?,?,?,?,?,?,?)`,
      );
      arr.forEach((u) =>
        stmt.run(
          u.id || Date.now() + Math.floor(Math.random() * 1000),
          u.username,
          u.fullName,
          u.email,
          u.phone,
          u.passwordHash,
          u.role || "user",
          u.created || new Date().toISOString(),
        ),
      );
      stmt.finalize();
    } catch (e) {
      console.error("Failed migrating users.json -> sqlite", e && e.message);
    }
  }
  if (fs.existsSync(TX_FILE)) {
    try {
      const arr = fs.readJsonSync(TX_FILE);
      const stmt = db.prepare(
        `INSERT OR IGNORE INTO transactions (id, type, amount, method, status, created) VALUES (?,?,?,?,?,?)`,
      );
      arr.forEach((t) =>
        stmt.run(
          t.id || Date.now() + Math.floor(Math.random() * 1000),
          t.type,
          t.amount || 0,
          t.method || "",
          t.status || "معلق",
          t.created || new Date().toISOString(),
        ),
      );
      stmt.finalize();
    } catch (e) {
      console.error(
        "Failed migrating transactions.json -> sqlite",
        e && e.message,
      );
    }
  }
}
migrateJsonToDb();

// admin pre-created user (credentials from env)
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

// Fail-fast in production if secrets are not set
if (isProd) {
  if (
    !process.env.SESSION_SECRET ||
    process.env.SESSION_SECRET === "dev-secret"
  ) {
    console.error(
      "NODE_ENV=production requires a strong SESSION_SECRET environment variable",
    );
    process.exit(1);
  }
  if (
    !process.env.ADMIN_PASSWORD ||
    process.env.ADMIN_PASSWORD === "admin123"
  ) {
    console.error(
      "NODE_ENV=production requires ADMIN_PASSWORD to be set to a non-default value",
    );
    process.exit(1);
  }
}
if (ADMIN_PASSWORD === "admin123")
  console.warn(
    "Using default admin password - change ADMIN_PASSWORD in .env before production",
  );
const ADMIN_USER = {
  username: ADMIN_USERNAME,
  passwordHash: bcrypt.hashSync(ADMIN_PASSWORD, 8),
};
// ensure admin user exists in DB
db.get(
  `SELECT * FROM users WHERE username = ?`,
  [ADMIN_USER.username],
  (err, row) => {
    if (!row) {
      db.run(
        `INSERT INTO users (id, username, passwordHash, role, created) VALUES (?,?,?,?,?)`,
        [
          Date.now(),
          ADMIN_USER.username,
          ADMIN_USER.passwordHash,
          "admin",
          new Date().toISOString(),
        ],
      );
    }
  },
);

// persistent failed login tracker using SQLite so lockouts survive restarts
function recordFailedLogin(key, cb) {
  const now = Date.now();
  db.get(
    `SELECT count, last, blockedUntil FROM failed_logins WHERE key = ?`,
    [key],
    (err, row) => {
      if (err) return cb && cb(err);
      let count = 1;
      let blockedUntil = 0;
      if (row) {
        count = (row.count || 0) + 1;
        // keep blockedUntil if already set
        blockedUntil = row.blockedUntil || 0;
      }
      if (count >= 5) {
        blockedUntil = now + 15 * 60 * 1000; // 15 minutes
      }
      db.run(
        `INSERT INTO failed_logins (key, count, last, blockedUntil) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count, last=excluded.last, blockedUntil=excluded.blockedUntil`,
        [key, count, now, blockedUntil],
        (e) => cb && cb(e),
      );
    },
  );
}

function clearFailedLogins(key, cb) {
  db.run(`DELETE FROM failed_logins WHERE key = ?`, [key], (e) => cb && cb(e));
}

function isBlocked(key, cb) {
  db.get(
    `SELECT count, last, blockedUntil FROM failed_logins WHERE key = ?`,
    [key],
    (err, row) => {
      if (err) return cb && cb(err, false);
      if (!row) return cb && cb(null, false);
      const now = Date.now();
      if (row.blockedUntil && now < row.blockedUntil)
        return cb && cb(null, true);
      // reset if last attempt was long ago (1 hour)
      if (now - (row.last || 0) > 60 * 60 * 1000) {
        // delete and treat as not blocked
        db.run(
          `DELETE FROM failed_logins WHERE key = ?`,
          [key],
          (e) => cb && cb(e, false),
        );
        return;
      }
      return cb && cb(null, false);
    },
  );
}

app.post("/api/admin/login", (req, res) => {
  // apply admin login specific rate limiting
  adminLoginLimiter(req, res, () => {
    const { username, password } = req.body;
    const key = req.ip + ":" + (username || "_");
    isBlocked(key, (err, blocked) => {
      if (err) {
        console.error("failed checking block status", err && err.message);
        // don't reveal too much
        return res.status(500).json({ error: "server" });
      }
      if (blocked)
        return res
          .status(429)
          .json({ error: "Too many failed attempts, try later" });
      db.get(
        `SELECT * FROM users WHERE username = ?`,
        [username],
        (err, user) => {
          if (err || !user) {
            recordFailedLogin(key, () => {});
            return res.status(401).json({ error: "Invalid" });
          }
          if (!bcrypt.compareSync(password, user.passwordHash)) {
            recordFailedLogin(key, () => {});
            return res.status(401).json({ error: "Invalid" });
          }
          // success: reset tracking
          clearFailedLogins(key, () => {});
          req.session.isAdmin = true;
          res.json({ ok: true });
        },
      );
    });
  });
});

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({ error: "Unauthorized" });
}

app.get("/api/admin/users", requireAdmin, (req, res) => {
  db.all(
    `SELECT id, username, role, created FROM users ORDER BY created DESC LIMIT 1000`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: "db" });
      res.json(rows);
    },
  );
});

app.get("/api/admin/transactions", requireAdmin, (req, res) => {
  db.all(
    `SELECT id, type, amount, method, status, created, updated FROM transactions ORDER BY created DESC LIMIT 200`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: "db" });
      res.json(rows);
    },
  );
});

// Health check endpoint used by load balancers / kubernetes
app.get("/health", (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.post("/api/admin/transaction", requireAdmin, (req, res) => {
  const { type, amount, method, status } = req.body;
  const created = new Date().toISOString();
  db.run(
    `INSERT INTO transactions (type, amount, method, status, created) VALUES (?,?,?,?,?)`,
    [type, amount || 0, method || "", status || "معلق", created],
    function (err) {
      if (err) return res.status(500).json({ error: "db" });
      db.get(
        `SELECT id, type, amount, method, status, created FROM transactions WHERE id = ?`,
        [this.lastID],
        (e, row) => {
          res.json(row);
        },
      );
    },
  );
});

// update transaction status (accept/reject)
app.post("/api/admin/transaction/:id/status", requireAdmin, (req, res) => {
  const id = req.params.id;
  const { status } = req.body;
  const updated = new Date().toISOString();
  db.run(
    `UPDATE transactions SET status = ?, updated = ? WHERE id = ?`,
    [status, updated, id],
    function (err) {
      if (err) return res.status(500).json({ error: "db" });
      db.get(
        `SELECT id, type, amount, method, status, created, updated FROM transactions WHERE id = ?`,
        [id],
        (e, row) => {
          if (e) return res.status(500).json({ error: "db" });
          res.json(row);
        },
      );
    },
  );
});

// update transaction status

// The duplicate JSON-based handler has been removed.

app.post("/api/register", (req, res) => {
  const { fullName, email, phone, password } = req.body;
  db.get(`SELECT id FROM users WHERE email = ?`, [email], (err, row) => {
    if (row) return res.status(400).json({ error: "exists" });
    const hashed = password ? bcrypt.hashSync(password, 8) : null;
    const username = email ? email.split("@")[0] : `user${Date.now()}`;
    const created = new Date().toISOString();
    db.run(
      `INSERT INTO users (username, fullName, email, phone, passwordHash, role, created) VALUES (?,?,?,?,?,?,?)`,
      [username, fullName, email, phone, hashed, "user", created],
      function (err) {
        if (err) return res.status(500).json({ error: "db" });
        res.json({ ok: true });
      },
    );
  });
});

app.post("/login", (req, res) => {
  const { identifier, password } = req.body;
  db.get(
    `SELECT * FROM users WHERE email = ? OR username = ?`,
    [identifier, identifier],
    (err, user) => {
      if (err || !user) return res.status(401).json({ error: "Invalid" });
      if (user.passwordHash && password) {
        if (!bcrypt.compareSync(password, user.passwordHash))
          return res.status(401).json({ error: "Invalid" });
      }
      req.session.user = {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        email: user.email,
      };
      res.json({ ok: true, user: req.session.user });
    },
  );
});

app.get("/api/me", (req, res) => {
  if (req.session && req.session.user) return res.json(req.session.user);
  res.status(401).json({ error: "no" });
});

const ADMIN_UI = path.join(__dirname, "admin.html");
const ADMIN_LOGIN_UI = path.join(__dirname, "admin-login.html");
app.get("/admin", (req, res) => {
  // if requesting admin UI, and not logged in, serve login (rate-limited to slow attackers)
  if (req.session && req.session.isAdmin) return res.sendFile(ADMIN_UI);
  // rate-limit the admin UI page to discourage scraping/login attempts
  return adminLimiter(req, res, () => res.sendFile(ADMIN_LOGIN_UI));
});

app.post("/api/admin/logout", (req, res) => {
  if (req.session) {
    req.session.isAdmin = false;
    req.session.destroy(() => {});
  }
  res.json({ ok: true });
});

const PORT = process.env.PORT || 4242;
app.listen(PORT, () => console.log("server listening on", PORT));
