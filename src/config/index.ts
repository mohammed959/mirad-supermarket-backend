import dotenv from 'dotenv';
dotenv.config();

const stripTrailingSlash = (s: string) => s.replace(/\/+$/, '');

export const config = {
  port: parseInt(process.env.PORT ?? '4000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  jwt: {
    secret: process.env.JWT_SECRET ?? 'dev-secret-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  },
  otp: {
    expiresMinutes: parseInt(process.env.OTP_EXPIRES_MINUTES ?? '5', 10),
    // TEMPORARY: when set, every generated customer OTP is forced to this
    // value (e.g. "123456") so testers can sign in without SMS. Unset in
    // production to restore random per-request OTPs.
    override: process.env.DEV_OTP_OVERRIDE?.trim() || null,
    // MVP: return the generated OTP in the request-otp response so the
    // marketplace can show it as a badge and testers can sign in without an
    // SMS gateway. Defaults to ON (works in production too). Set
    // OTP_EXPOSE_CODE=false once a real SMS provider is wired up so codes are
    // no longer leaked to the client.
    exposeCode: (process.env.OTP_EXPOSE_CODE ?? 'true').toLowerCase() !== 'false',
  },
  bunny: {
    // Product images moved to Cloudinary (see `cloudinary` below,
    // `lib/productImage.ts::getProductImageUrl`) — this default fallback is
    // still just a plain URL, unrelated to which CDN hosts the real assets.
    defaultProductImageUrl:
      process.env.DEFAULT_PRODUCT_IMAGE_URL ??
      'https://your-zone.b-cdn.net/products/default/default.png',

    // Categories: ${categoryBaseUrl}/{english-slug}.${categoryExtension}
    categoryBaseUrl: stripTrailingSlash(
      process.env.BUNNY_CATEGORY_BASE_URL ?? 'https://your-zone.b-cdn.net/category'
    ),
    categoryExtension: (process.env.BUNNY_CATEGORY_IMAGE_EXT ?? 'png').replace(/^\./, ''),
    defaultCategoryImageUrl:
      process.env.DEFAULT_CATEGORY_IMAGE_URL ??
      'https://your-zone.b-cdn.net/category/default/default.png',

    // Brands: ${brandBaseUrl}/{english-slug}.${brandExtension}
    brandBaseUrl: stripTrailingSlash(
      process.env.BUNNY_BRAND_BASE_URL ?? 'https://your-zone.b-cdn.net/brand'
    ),
    brandExtension: (process.env.BUNNY_BRAND_IMAGE_EXT ?? 'png').replace(/^\./, ''),
    defaultBrandImageUrl:
      process.env.DEFAULT_BRAND_IMAGE_URL ??
      'https://your-zone.b-cdn.net/brand/default/default.png',

    // ── Storage Zone (writable) — customer-uploaded images ───────────
    // Uploads go via HTTP PUT to the Storage Zone; served back over the
    // public Pull Zone. See lib/bunnyStorage.ts. Host depends on the zone's
    // primary region (default main region = storage.bunnycdn.com).
    storageHost: process.env.BUNNY_STORAGE_HOST ?? 'storage.bunnycdn.com',
    storageZone: process.env.BUNNY_STORAGE_ZONE_NAME ?? '',
    storageAccessKey: process.env.BUNNY_STORAGE_ACCESS_KEY ?? '',
    // Public CDN root whose origin is the Storage Zone above.
    publicBaseUrl: stripTrailingSlash(
      process.env.BUNNY_PUBLIC_BASE_URL ?? 'https://apprafed.b-cdn.net'
    ),
    // Folder inside the Storage Zone for customer uploads (no slashes).
    customerFolder: (process.env.BUNNY_CUSTOMER_UPLOAD_FOLDER ?? 'Customers').replace(/^\/+|\/+$/g, ''),
    // Folder inside the Storage Zone for admin-uploaded subcategory images.
    subcategoryFolder: (process.env.BUNNY_SUBCATEGORY_UPLOAD_FOLDER ?? 'Subcategories').replace(/^\/+|\/+$/g, ''),
  },
  // Product images: Cloudinary Public ID === Product SKU (never barcode).
  // Delivery URL: https://res.cloudinary.com/{cloudName}/image/upload/{transformations}/{productFolder}/{sku}
  // Unsigned delivery URLs only need `cloudName` — apiKey/apiSecret are
  // captured here for any future signed/admin Cloudinary operation
  // (uploads, deletions) but are NOT used by `getProductImageUrl`.
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME ?? '',
    apiKey: process.env.CLOUDINARY_API_KEY ?? '',
    apiSecret: process.env.CLOUDINARY_API_SECRET ?? '',
    productFolder: (process.env.CLOUDINARY_PRODUCT_FOLDER ?? 'mirad/products').replace(/^\/+|\/+$/g, ''),
    // Delivery transformations applied to every product image, centralized
    // here so they can be changed in one place. `f_auto,q_auto` lets
    // Cloudinary pick the best format/quality per requesting browser
    // instead of forcing a fixed extension.
    productTransformations: process.env.CLOUDINARY_PRODUCT_TRANSFORMATIONS ?? 'f_auto,q_auto',
  },
  isDev: (process.env.NODE_ENV ?? 'development') === 'development',
};
