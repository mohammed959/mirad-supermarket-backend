/**
 * OpenAPI 3.0.3 spec for the Alhathlul Supermarket backend.
 *
 * The spec is assembled programmatically from the per-tag path files
 * under `./paths/` and the shared `./schemas` file. This keeps each
 * module's Swagger definition next to that module's mental model without
 * spraying JSDoc annotations across dozens of route/controller files.
 *
 * Nothing here reads from Express — it only produces a JSON object that
 * `swagger-ui-express` renders at `/api-docs` and `swagger-jsdoc`-style
 * consumers can fetch at `/api-docs.json`.
 *
 * Server URLs are driven by env vars (see `.env.example`):
 *
 *   SWAGGER_SERVER_URL_DEV   default: http://localhost:${PORT}
 *   SWAGGER_SERVER_URL_PROD  default: https://api.alhathlul.sa
 */
import { config } from '../config';
import { schemas } from './schemas';

import { authPaths } from './paths/auth';
import { customerPaths } from './paths/customer';
import { categoryPaths } from './paths/categories';
import { productPaths } from './paths/products';
import { brandPaths } from './paths/brands';
import { orderPaths } from './paths/orders';
import { checkoutPaths } from './paths/checkout';
import { deliveryPaths } from './paths/delivery';
import { subscriptionPaths } from './paths/subscriptions';
import { notificationPaths } from './paths/notifications';
import { addressPaths } from './paths/addresses';
import { favoritePaths } from './paths/favorites';
import { bannerPaths } from './paths/banners';
import { featuredSectionPaths } from './paths/featuredSections';
import { promotionPaths } from './paths/promotions';
import { pickupPaths } from './paths/pickup';
import { auditPaths } from './paths/audit';
import { inventoryPaths } from './paths/inventory';
import { settingsPaths } from './paths/settings';
import { uploadPaths } from './paths/uploads';
import { storefrontPaths } from './paths/storefront';

// Server URLs already include the `/api` mount prefix, so every documented
// path key is relative to `/api` (e.g. `/auth/request-otp`). Override via env
// so "Try it out" targets the right host in each environment.
const devUrl =
  process.env.SWAGGER_SERVER_URL_DEV || `http://localhost:${config.port}/api`;
const prodUrl =
  process.env.SWAGGER_SERVER_URL_PROD || 'https://api.mirad-market.com/api';

const tags = [
  { name: 'Authentication', description: 'OTP + staff email/password login. All tokens are HS256 JWTs, 7-day lifetime.' },
  { name: 'Profile', description: 'The current authenticated user.' },
  { name: 'Customer', description: 'Customer self-service endpoints.' },
  { name: 'Products', description: 'Storefront catalog + admin product management.' },
  { name: 'Categories', description: 'Category tree with subcategories.' },
  { name: 'Brands', description: 'Brand catalog.' },
  { name: 'Cart', description: 'The cart is client-side; server-side surface is exposed via Checkout + Delivery.' },
  { name: 'Wishlist', description: 'Alias for the Favorites tag — same underlying endpoints.' },
  { name: 'Favorites', description: 'Customer wishlist / favorites.' },
  { name: 'Orders', description: 'Order lifecycle from customer create → picker → driver → complete.' },
  { name: 'Checkout', description: 'Cart totals, delivery fee resolution, pickup slot availability.' },
  { name: 'Payments', description: 'Payment proofs + admin verification for bank-transfer orders.' },
  { name: 'Coupons', description: 'Coupons are surfaced via the Promotions tag (BUY_X_GET_Y, discounts, thresholds, etc.).' },
  { name: 'Promotions', description: 'Cart promotions applied automatically by the backend.' },
  { name: 'Notifications', description: 'Customer notifications + admin broadcasts.' },
  { name: 'Notifications (Admin)', description: 'Admin broadcast + history endpoints.' },
  { name: 'Addresses', description: 'Customer address book.' },
  { name: 'Delivery', description: 'Delivery fee quote, branch coverage, minimum-order, distance rules.' },
  { name: 'Branches', description: 'Currently a single active branch.' },
  { name: 'Subscriptions', description: 'Delivery benefit subscription plans.' },
  { name: 'Subscriptions (Admin)', description: 'Plan CRUD + subscriber management.' },
  { name: 'Pickup', description: 'Pickup-from-branch settings and time-slot capacity.' },
  { name: 'Featured Sections', description: 'Curated home-page product carousels.' },
  { name: 'Banners', description: 'Storefront banners.' },
  { name: 'Storefront', description: 'Aggregated public reads that power the marketplace homepage in a single call.' },
  { name: 'Settings', description: 'Admin-managed pricing, home + coverage settings.' },
  { name: 'Uploads', description: 'Customer image uploads (delivery-location photos) to the CDN.' },
  { name: 'Users (Admin)', description: 'Admin CRUD for staff and customer accounts.' },
  { name: 'Inventory', description: 'Bulk price / stock update via Excel.' },
  { name: 'Audit', description: 'Read-only audit log for admin writes.' },
];

export const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Alhathlul Supermarket API',
    version: '1.0.0',
    description: [
      'REST API for the Alhathlul Supermarket quick-commerce platform.',
      '',
      '**Envelope:** every successful response is `{ success: true, message, data }`; every error is `{ success: false, message, errors? }`.',
      '',
      '**Auth:** send `Authorization: Bearer <JWT>` on protected endpoints. Customer JWTs (issued by `/api/auth/verify-otp`) are accepted only on customer endpoints; staff JWTs (issued by `/api/auth/staff/login`) are accepted only on staff endpoints. `authenticateAny` endpoints (like `/api/auth/me`, `/api/orders`, `/api/orders/:id`) accept either.',
      '',
      '**Rate limits:** 200 requests per 15-minute window per IP across every route.',
      '',
      '**Locale:** the storefront speaks both `ar` and `en`; every user-facing entity carries mirrored `name` / `nameAr` fields.',
    ].join('\n'),
    contact: {
      name: 'Alhathlul Engineering',
      email: 'engineering@alhathlul.sa',
    },
    license: { name: 'Proprietary' },
  },
  servers: [
    { url: devUrl, description: 'Local development' },
    { url: prodUrl, description: 'Production' },
  ],
  tags,
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'JWT issued by `/api/auth/verify-otp` (customer) or `/api/auth/staff/login` (staff). Pass as `Authorization: Bearer <token>`.',
      },
    },
    schemas,
  },
  paths: {
    ...authPaths,
    ...customerPaths,
    ...categoryPaths,
    ...productPaths,
    ...brandPaths,
    ...orderPaths,
    ...checkoutPaths,
    ...deliveryPaths,
    ...subscriptionPaths,
    ...notificationPaths,
    ...addressPaths,
    ...favoritePaths,
    ...bannerPaths,
    ...featuredSectionPaths,
    ...promotionPaths,
    ...pickupPaths,
    ...auditPaths,
    ...inventoryPaths,
    ...settingsPaths,
    ...uploadPaths,
    ...storefrontPaths,
  },
};

export default openapiSpec;
