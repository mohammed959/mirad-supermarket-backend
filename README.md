# Alhathlul Supermarket — Backend

Express 4 + Prisma 5 + MySQL 9 + Zod + JWT.

## Run

```bash
npm install
cp .env.example .env      # fill in DATABASE_URL / JWT_SECRET / Bunny CDN
npx prisma migrate deploy
npm run dev               # ts-node-dev with reload
# or
npm run build && npm start
```

Server listens on `PORT` (default `4000`).

## API Documentation (Swagger / OpenAPI 3.0.3)

The full API surface is documented at:

| Path              | What it serves                                 |
|-------------------|------------------------------------------------|
| `/api-docs`       | Interactive Swagger UI (browsable, "Try it out") |
| `/api-docs.json`  | Raw OpenAPI 3.0.3 JSON — feed to codegen tools |

Local: <http://localhost:4000/api-docs>
Production: `<SWAGGER_SERVER_URL_PROD>/api-docs`

### Env vars

```env
SWAGGER_SERVER_URL_DEV=http://localhost:4000/api
SWAGGER_SERVER_URL_PROD=https://api.mirad-market.com/api
```

Both surface in the "Servers" dropdown at the top of Swagger UI so QA can flip
between local and prod without editing anything. The server URLs **include the
`/api` base path**, so every documented endpoint is relative to it (e.g.
`/auth/request-otp` → `http://localhost:4000/api/auth/request-otp`). This keeps
"Try it out" hitting the correct absolute URL in both environments. `_DEV`
defaults to `http://localhost:${PORT}/api` when unset.

### Authorize in Swagger UI

1. Call `POST /api/auth/verify-otp` (customer) or `POST /api/auth/staff/login`
   (staff) via the "Try it out" panel.
2. Copy the `data.token` value from the 200 response.
3. Click the **Authorize** button at the top-right of `/api-docs`.
4. Paste the token — Swagger prefixes `Bearer` automatically.
5. `persistAuthorization` is on, so the token is remembered across reloads.

Customer tokens are rejected on staff endpoints and vice versa (403).

### Regenerating clients

Point OpenAPI codegen tools at `http://localhost:4000/api-docs.json`. Examples:

```bash
# Dart / Flutter
dart pub global run openapi_generator generate \
  --input-spec http://localhost:4000/api-docs.json \
  --generator-name dart --output ./lib/api

# TypeScript (openapi-typescript)
npx openapi-typescript http://localhost:4000/api-docs.json -o src/api.d.ts
```

### File layout

The spec is assembled programmatically — one file per tag under
`src/docs/paths/`, shared schemas in `src/docs/schemas.ts`, glued together in
`src/docs/openapi.ts`. Adding an endpoint means adding one entry to the right
path file; no code lives in the routes/controllers themselves.

```
src/docs/
├─ openapi.ts        # top-level spec assembly (info, servers, tags, components)
├─ schemas.ts        # reusable Product / Order / Address / … schemas
├─ helpers.ts        # bearerAuth, errorResponses, success() wrapper
└─ paths/
   ├─ auth.ts
   ├─ addresses.ts
   ├─ audit.ts
   ├─ banners.ts
   ├─ brands.ts
   ├─ categories.ts
   ├─ checkout.ts
   ├─ customer.ts        # /users/me + /users/* admin
   ├─ delivery.ts
   ├─ favorites.ts
   ├─ featuredSections.ts
   ├─ inventory.ts
   ├─ notifications.ts
   ├─ orders.ts
   ├─ pickup.ts
   ├─ products.ts
   ├─ promotions.ts
   ├─ settings.ts        # /settings/home
   ├─ subscriptions.ts
   └─ uploads.ts         # /uploads/delivery-image
```

## Response envelope

Every response is wrapped by `src/lib/response.ts`:

```json
{ "success": true,  "message": "Success",     "data": <payload> }
{ "success": false, "message": "Unauthorized" }
```
