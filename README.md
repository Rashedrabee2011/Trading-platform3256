# Tadawul PAY - Local Dev & Admin

This repo is a PoC with a small Express server and static frontend pages.

Quick start (dev):

1. Copy `.env.example` to `.env` and fill values.
2. Install deps:

```powershell
npm install
```

3. Run server:

```powershell
node server.js
```

Admin UI: http://127.0.0.1:4242/admin

Default admin credentials are read from `.env` (`ADMIN_USERNAME`/`ADMIN_PASSWORD`).

Docker:

```powershell
docker build -t tadawul-pay .
docker run -p 4242:4242 --env-file .env tadawul-pay
```

Security notes: This is a PoC. Before production:

- Use a real DB (Postgres), session store (Redis).
- Use HTTPS, strong SESSION_SECRET, rotate admin password, enable 2FA for admin.
- Review PCI and privacy compliance for payment flows.
