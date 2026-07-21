/**
 * Response DTOs for `GET /api/storefront/home`.
 *
 * Wire format guarantees:
 *   • Prices are strings (matches how Prisma Decimal serializes today via
 *     Express `res.json`). Legacy products with a null DB price map to
 *     `null` so the frontend can render "Price unavailable" instead of a
 *     misleading zero.
 *   • Image URLs are always populated strings — resolved server-side via
 *     the existing helpers in `lib/productImage.ts`. Blank/missing SKUs or
 *     slugs fall back to the default CDN image.
 *   • Every user-facing entity carries mirrored `name`/`nameAr` (or
 *     `title`/`titleAr`) so the storefront can render in either locale
 *     from one payload. No locale flavor, no `Vary: Accept-Language`.
 *   • Product cards deliberately omit `category`, `subcategory`, `brand`,
 *     `variants`, `description`, `stock`, `reserved`, and `isActive`. The
 *     home page never renders those; keeping them out shrinks the wire and
 *     removes join work.
 */

export interface HomeSubcategoryCard {
  id: string;
  name: string;
  nameAr: string;
  slug: string;
  imageUrl: string;
  sortOrder: number;
}

export interface HomeCategoryCard {
  id: string;
  name: string;
  nameAr: string;
  slug: string;
  imageUrl: string;
  sortOrder: number;
  /** Active subcategories under this category, sorted by sortOrder asc. `[]` when none. */
  subCategories: HomeSubcategoryCard[];
}

export interface HomeBanner {
  id: string;
  title: string;
  titleAr: string;
  imageUrl: string;
  linkType: string | null;
  linkValue: string | null;
  sortOrder: number;
}

export interface ProductCard {
  id: string;
  name: string;
  nameAr: string;
  sku: string | null;
  imageUrl: string;
  /**
   * Price as a decimal string ("6.5", "12.75"). Matches the current wire
   * format produced when Prisma Decimal is serialized via Express. `null`
   * for legacy products whose price column is unset.
   */
  price: string | null;
  /** `product.isActive && (product.stock - product.reserved) > 0`. */
  available: boolean;
}

export interface HomeFeaturedSection {
  id: string;
  name: string;
  nameAr: string;
  sortOrder: number;
  products: ProductCard[];
}

export interface HomeAllProducts {
  items: ProductCard[];
  /** `true` when the server has more all-products rows than the response includes. */
  hasMore: boolean;
}

export interface HomeAggregate {
  categories: HomeCategoryCard[];
  banners: HomeBanner[];
  featuredProducts: ProductCard[];
  featuredSections: HomeFeaturedSection[];
  allProducts: HomeAllProducts;
}
