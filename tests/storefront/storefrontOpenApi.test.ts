/**
 * Structural validation of the storefront homepage OpenAPI documentation.
 *
 * No external validator is installed and adding a large one solely for
 * this step is out of scope. Instead we load the assembled spec, walk
 * every `$ref` reachable from `/storefront/home`, and assert the target
 * resolves inside `components.schemas`. Also verifies the path is
 * registered exactly once, `Cache-Control` is documented, the response
 * example matches the schema shape, and the endpoint carries no
 * per-operation `security`.
 *
 * Run:
 *   cd backend && npx ts-node --transpile-only tests/storefront/storefrontOpenApi.test.ts
 */

import assert from 'node:assert/strict';
import { openapiSpec } from '../../src/docs/openapi';

// ── Tiny in-file test harness ────────────────────────────────────────
const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

// ── Ref resolver ─────────────────────────────────────────────────────
function resolveRef(spec: Record<string, unknown>, ref: string): unknown {
  assert.ok(ref.startsWith('#/'), `only local refs supported: ${ref}`);
  const parts = ref.slice(2).split('/');
  let cur: unknown = spec;
  for (const part of parts) {
    assert.ok(cur && typeof cur === 'object', `ref ${ref} broke at "${part}"`);
    cur = (cur as Record<string, unknown>)[part];
    assert.ok(cur !== undefined, `ref ${ref} missing at "${part}"`);
  }
  return cur;
}

function collectRefs(node: unknown, out: string[]): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((child) => collectRefs(child, out));
    return;
  }
  const obj = node as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    if (k === '$ref' && typeof v === 'string') out.push(v);
    else collectRefs(v, out);
  }
}

// ── Tests ────────────────────────────────────────────────────────────
test('storefront path is registered exactly once', () => {
  const paths = openapiSpec.paths as Record<string, unknown>;
  // Any close variant would indicate a doubled or missing prefix.
  const relevantKeys = Object.keys(paths).filter((k) => k.includes('storefront'));
  assert.deepEqual(relevantKeys, ['/storefront/home']);
});

test('path prefix matches the file-wide convention (relative to /api, no /api in the key)', () => {
  const paths = openapiSpec.paths as Record<string, unknown>;
  // Sanity check: any documented path must NOT start with /api because
  // the /api prefix already lives in `servers[0].url`.
  for (const key of Object.keys(paths)) {
    assert.ok(!key.startsWith('/api'), `path key must not include /api: ${key}`);
  }
  assert.ok('/storefront/home' in paths);
});

test('GET /storefront/home operation exists with the required OpenAPI fields', () => {
  const op = ((openapiSpec.paths as Record<string, Record<string, unknown>>)['/storefront/home']
    .get) as Record<string, unknown>;
  assert.ok(op, 'GET operation must exist');
  assert.ok(Array.isArray(op.tags) && (op.tags as string[]).includes('Storefront'));
  assert.equal(typeof op.summary, 'string');
  assert.equal(typeof op.description, 'string');
  assert.ok(op.responses);
});

test('operation is public — no per-operation security block', () => {
  const op = ((openapiSpec.paths as Record<string, Record<string, unknown>>)['/storefront/home']
    .get) as Record<string, unknown>;
  // Convention: public endpoints omit `security` entirely. There is no
  // root-level `security` array, so absence here means unauthenticated.
  assert.equal((op as Record<string, unknown>).security, undefined);
  assert.equal((openapiSpec as Record<string, unknown>).security, undefined);
});

test('200 response documents Cache-Control: no-cache', () => {
  const op = ((openapiSpec.paths as Record<string, Record<string, unknown>>)['/storefront/home']
    .get) as Record<string, Record<string, unknown>>;
  const ok = op.responses['200'] as Record<string, unknown>;
  assert.ok(ok, '200 response required');
  const headers = ok.headers as Record<string, { schema: { example?: string } }>;
  assert.ok(headers, 'headers block required');
  assert.ok(headers['Cache-Control'], 'Cache-Control header required');
  assert.equal(headers['Cache-Control'].schema.example, 'no-cache');
});

test('Cache-Control description does not guarantee a 304 on every unchanged response', () => {
  const op = ((openapiSpec.paths as Record<string, Record<string, unknown>>)['/storefront/home']
    .get) as Record<string, Record<string, unknown>>;
  const ok = op.responses['200'] as {
    headers: Record<string, { description: string }>;
  };
  const desc = ok.headers['Cache-Control'].description;
  // Absolute-guarantee phrasings that must not appear.
  const forbiddenSubstrings = [
    'always return 304',
    'always returns 304',
    'always return `304',
    'always returns `304',
    'will return 304',
    'will return `304',
    'guarantees 304',
    'guaranteed 304',
    'still return 304',
    'still return `304',
    'still returns 304',
    'still returns `304',
  ];
  const lower = desc.toLowerCase();
  for (const bad of forbiddenSubstrings) {
    assert.ok(
      !lower.includes(bad.toLowerCase()),
      `Cache-Control description must not guarantee 304: found "${bad}"`,
    );
  }
});

test('Cache-Control description accurately explains revalidation and conditional 304 behavior', () => {
  const op = ((openapiSpec.paths as Record<string, Record<string, unknown>>)['/storefront/home']
    .get) as Record<string, Record<string, unknown>>;
  const ok = op.responses['200'] as {
    headers: Record<string, { description: string }>;
  };
  const desc = ok.headers['Cache-Control'].description.toLowerCase();
  // Must mention revalidation semantics.
  assert.ok(desc.includes('revalidate'), 'description must mention revalidation');
  // Must acknowledge Express\'s ETag behavior.
  assert.ok(desc.includes('etag'), 'description must mention ETag behavior');
  // Must frame 304 as conditional (`may`), not guaranteed.
  const hasConditionalMay = /\bmay\b[^.]*304/.test(desc) || /304[^.]*\bmay\b/.test(desc);
  assert.ok(hasConditionalMay, 'description must frame 304 as conditional (e.g. "MAY receive 304")');
});

test('500 response is documented via the shared error envelope', () => {
  const op = ((openapiSpec.paths as Record<string, Record<string, unknown>>)['/storefront/home']
    .get) as Record<string, Record<string, unknown>>;
  const err = op.responses['500'] as {
    content: {
      'application/json': { schema: Record<string, string> };
    };
  };
  assert.ok(err);
  assert.equal(
    err.content['application/json'].schema.$ref,
    '#/components/schemas/ErrorResponse',
  );
});

test('every $ref reachable from /storefront/home resolves in components', () => {
  const op = (openapiSpec.paths as Record<string, unknown>)['/storefront/home'];
  const refs: string[] = [];
  collectRefs(op, refs);
  // Sanity: the storefront-specific refs must appear.
  const uniqueRefs = Array.from(new Set(refs));
  for (const ref of uniqueRefs) {
    resolveRef(openapiSpec as unknown as Record<string, unknown>, ref);
  }
  assert.ok(uniqueRefs.includes('#/components/schemas/StorefrontHomeAggregate'));
  assert.ok(uniqueRefs.includes('#/components/schemas/ApiSuccess'));
  assert.ok(uniqueRefs.includes('#/components/schemas/ErrorResponse'));
});

test('storefront component schemas do not leak forbidden ProductCard fields', () => {
  const productCard = ((openapiSpec.components as Record<string, unknown>).schemas as Record<
    string,
    { properties: Record<string, unknown>; required: string[] }
  >).StorefrontProductCard;
  assert.ok(productCard);
  const keys = Object.keys(productCard.properties).sort();
  assert.deepEqual(keys, [
    'available',
    'id',
    'imageUrl',
    'name',
    'nameAr',
    'price',
    'sku',
  ]);
  for (const forbidden of [
    'category',
    'subcategory',
    'brand',
    'variants',
    'description',
    'descriptionAr',
    'stock',
    'reserved',
    'isActive',
    'createdAt',
    'updatedAt',
    'barcode',
    'hideFromHome',
    'isFeatured',
    'categoryId',
    'subcategoryId',
    'brandId',
  ]) {
    assert.equal(
      productCard.properties[forbidden],
      undefined,
      `StorefrontProductCard leaked forbidden property: ${forbidden}`,
    );
  }
  // Required list must exactly match the DTO's non-optional fields.
  assert.deepEqual(
    [...productCard.required].sort(),
    ['available', 'id', 'imageUrl', 'name', 'nameAr', 'price', 'sku'],
  );
});

test('StorefrontHomeCategoryCard has no subcategories, no isActive, no audit fields', () => {
  const cat = ((openapiSpec.components as Record<string, unknown>).schemas as Record<
    string,
    { properties: Record<string, unknown> }
  >).StorefrontHomeCategoryCard;
  const keys = Object.keys(cat.properties).sort();
  assert.deepEqual(keys, ['id', 'imageUrl', 'name', 'nameAr', 'slug', 'sortOrder']);
  for (const forbidden of ['subcategories', 'isActive', 'createdAt', 'updatedAt']) {
    assert.equal(cat.properties[forbidden], undefined);
  }
});

test('StorefrontHomeBanner keeps nullable link fields, drops isActive', () => {
  const banner = ((openapiSpec.components as Record<string, unknown>).schemas as Record<
    string,
    { properties: Record<string, { nullable?: boolean }> }
  >).StorefrontHomeBanner;
  const keys = Object.keys(banner.properties).sort();
  assert.deepEqual(keys, [
    'id',
    'imageUrl',
    'linkType',
    'linkValue',
    'sortOrder',
    'title',
    'titleAr',
  ]);
  assert.equal(banner.properties.linkType.nullable, true);
  assert.equal(banner.properties.linkValue.nullable, true);
  assert.equal(banner.properties.isActive, undefined);
});

test('StorefrontHomeAllProducts has items + hasMore only', () => {
  const all = ((openapiSpec.components as Record<string, unknown>).schemas as Record<
    string,
    { properties: Record<string, unknown> }
  >).StorefrontHomeAllProducts;
  assert.deepEqual(Object.keys(all.properties).sort(), ['hasMore', 'items']);
});

// ── DTO ↔ Schema parity (nullability + required) ────────────────────
//
// For each storefront schema, assert:
//   - every property listed by the DTO is documented,
//   - `nullable: true` iff the TS type includes `| null`,
//   - `required` array exactly matches the property-presence contract
//     (in TypeScript every DTO property is non-optional; the DTO signals
//     nullability with a value-level `| null`, never with `?:`, so every
//     property is present and every property belongs in `required`).
//
// Source of truth: `backend/src/modules/storefront/storefront.types.ts`.
//
// Findings baked in:
//   ProductCard.price       → nullable string
//   ProductCard.sku         → nullable string
//   ProductCard.imageUrl    → non-nullable string
//   HomeCategoryCard.imageUrl → non-nullable string
//   HomeBanner.imageUrl     → non-nullable string
//   HomeBanner.linkType     → nullable string
//   HomeBanner.linkValue    → nullable string
//   (All *.name / *.nameAr / *.title / *.titleAr / *.id / *.slug / *.sortOrder
//    / *.available / *.hasMore are non-nullable.)
//
// A property may be listed in `required` AND marked `nullable: true` —
// that combination means "the key is always present, but the value may
// be null". This is exactly what the storefront DTO uses for `sku`,
// `price`, `linkType`, `linkValue`.

type SchemaProp = { type?: string; nullable?: boolean; $ref?: string };
type SchemaObject = {
  type?: string;
  required?: string[];
  properties: Record<string, SchemaProp | Record<string, unknown>>;
};
function schema(name: string): SchemaObject {
  const store = (openapiSpec.components as Record<string, unknown>).schemas as Record<
    string,
    SchemaObject
  >;
  const s = store[name];
  assert.ok(s, `component schema ${name} must exist`);
  return s;
}

function assertRequiredEqualsAllKeys(name: string) {
  const s = schema(name);
  const props = Object.keys(s.properties).sort();
  const required = [...(s.required ?? [])].sort();
  assert.deepEqual(
    required,
    props,
    `${name}: required must list every DTO property (none are optional in the TS type)`,
  );
}

function assertPropNullable(name: string, propName: string, shouldBeNullable: boolean) {
  const s = schema(name);
  const p = s.properties[propName] as SchemaProp | undefined;
  assert.ok(p, `${name}.${propName} must be documented`);
  const actual = p.nullable === true;
  if (shouldBeNullable) {
    assert.equal(actual, true, `${name}.${propName} must be nullable: true (DTO says string | null)`);
  } else {
    // "nullable: false" or the absence of the key are both non-nullable in OAS 3.0.
    assert.notEqual(
      actual,
      true,
      `${name}.${propName} must NOT be nullable (DTO says non-nullable)`,
    );
  }
}

test('StorefrontProductCard: nullability + required match the DTO exactly', () => {
  assertRequiredEqualsAllKeys('StorefrontProductCard');
  // Non-nullable
  assertPropNullable('StorefrontProductCard', 'id', false);
  assertPropNullable('StorefrontProductCard', 'name', false);
  assertPropNullable('StorefrontProductCard', 'nameAr', false);
  assertPropNullable('StorefrontProductCard', 'imageUrl', false);
  assertPropNullable('StorefrontProductCard', 'available', false);
  // Nullable
  assertPropNullable('StorefrontProductCard', 'sku', true);
  assertPropNullable('StorefrontProductCard', 'price', true);
});

test('ProductCard.price: string | null wire representation is enforced', () => {
  const s = schema('StorefrontProductCard');
  const price = s.properties.price as SchemaProp & { example?: string };
  assert.equal(price.type, 'string', 'price must be a string on the wire (Prisma Decimal → JSON string)');
  assert.equal(price.nullable, true, 'price must accept null for legacy products with no price');
  // Sanity: example is a string too.
  if (price.example !== undefined) {
    assert.equal(typeof price.example, 'string');
  }
});

test('StorefrontHomeCategoryCard: nullability + required match the DTO exactly', () => {
  assertRequiredEqualsAllKeys('StorefrontHomeCategoryCard');
  // All six fields non-nullable in the DTO.
  for (const p of ['id', 'name', 'nameAr', 'slug', 'imageUrl', 'sortOrder']) {
    assertPropNullable('StorefrontHomeCategoryCard', p, false);
  }
});

test('StorefrontHomeBanner: nullability + required match the DTO exactly', () => {
  assertRequiredEqualsAllKeys('StorefrontHomeBanner');
  // Non-nullable
  for (const p of ['id', 'title', 'titleAr', 'imageUrl', 'sortOrder']) {
    assertPropNullable('StorefrontHomeBanner', p, false);
  }
  // Nullable
  assertPropNullable('StorefrontHomeBanner', 'linkType', true);
  assertPropNullable('StorefrontHomeBanner', 'linkValue', true);
});

test('StorefrontFeaturedSection: nullability + required match the DTO exactly', () => {
  assertRequiredEqualsAllKeys('StorefrontFeaturedSection');
  for (const p of ['id', 'name', 'nameAr', 'sortOrder', 'products']) {
    assertPropNullable('StorefrontFeaturedSection', p, false);
  }
  // products items → StorefrontProductCard $ref.
  const s = schema('StorefrontFeaturedSection');
  const products = s.properties.products as { items?: { $ref?: string } };
  assert.equal(products.items?.$ref, '#/components/schemas/StorefrontProductCard');
});

test('StorefrontHomeAllProducts: nullability + required match the DTO exactly', () => {
  assertRequiredEqualsAllKeys('StorefrontHomeAllProducts');
  assertPropNullable('StorefrontHomeAllProducts', 'items', false);
  assertPropNullable('StorefrontHomeAllProducts', 'hasMore', false);
});

test('StorefrontHomeAggregate: every top-level slice is required and non-nullable', () => {
  assertRequiredEqualsAllKeys('StorefrontHomeAggregate');
  for (const p of ['categories', 'banners', 'featuredProducts', 'featuredSections', 'allProducts']) {
    assertPropNullable('StorefrontHomeAggregate', p, false);
  }
});

test('sanity: no storefront schema accidentally marks a DTO-non-nullable field as nullable', () => {
  const nonNullableByDto: Array<[string, string]> = [
    ['StorefrontProductCard', 'id'],
    ['StorefrontProductCard', 'name'],
    ['StorefrontProductCard', 'nameAr'],
    ['StorefrontProductCard', 'imageUrl'],
    ['StorefrontProductCard', 'available'],
    ['StorefrontHomeCategoryCard', 'id'],
    ['StorefrontHomeCategoryCard', 'name'],
    ['StorefrontHomeCategoryCard', 'nameAr'],
    ['StorefrontHomeCategoryCard', 'slug'],
    ['StorefrontHomeCategoryCard', 'imageUrl'],
    ['StorefrontHomeCategoryCard', 'sortOrder'],
    ['StorefrontHomeBanner', 'id'],
    ['StorefrontHomeBanner', 'title'],
    ['StorefrontHomeBanner', 'titleAr'],
    ['StorefrontHomeBanner', 'imageUrl'],
    ['StorefrontHomeBanner', 'sortOrder'],
    ['StorefrontFeaturedSection', 'id'],
    ['StorefrontFeaturedSection', 'name'],
    ['StorefrontFeaturedSection', 'nameAr'],
    ['StorefrontFeaturedSection', 'sortOrder'],
    ['StorefrontFeaturedSection', 'products'],
    ['StorefrontHomeAllProducts', 'items'],
    ['StorefrontHomeAllProducts', 'hasMore'],
  ];
  for (const [name, prop] of nonNullableByDto) {
    assertPropNullable(name, prop, false);
  }
});

test('response example is structurally consistent with the documented aggregate', () => {
  const op = ((openapiSpec.paths as Record<string, Record<string, unknown>>)['/storefront/home']
    .get) as Record<string, Record<string, unknown>>;
  const ok = op.responses['200'] as {
    content: {
      'application/json': { example: { success: boolean; message: string; data: Record<string, unknown> } };
    };
  };
  const ex = ok.content['application/json'].example;
  assert.equal(ex.success, true);
  assert.equal(ex.message, 'Success');
  assert.ok(ex.data);
  assert.deepEqual(Object.keys(ex.data).sort(), [
    'allProducts',
    'banners',
    'categories',
    'featuredProducts',
    'featuredSections',
  ]);
  // Card in the example has exactly the ProductCard whitelisted keys.
  const anyCard = (ex.data.featuredProducts as Array<Record<string, unknown>>)[0];
  assert.deepEqual(Object.keys(anyCard).sort(), [
    'available',
    'id',
    'imageUrl',
    'name',
    'nameAr',
    'price',
    'sku',
  ]);
  // Price is a decimal STRING, not a number.
  assert.equal(typeof anyCard.price, 'string');
  // hasMore is a boolean.
  const allProducts = ex.data.allProducts as { items: unknown[]; hasMore: boolean };
  assert.equal(typeof allProducts.hasMore, 'boolean');
});

test('/api-docs.json (JSON snapshot) contains the storefront path exactly once and its schemas resolve', () => {
  const asJson = JSON.parse(JSON.stringify(openapiSpec)) as Record<string, unknown>;
  const paths = asJson.paths as Record<string, unknown>;
  const matches = Object.keys(paths).filter((k) => k === '/storefront/home');
  assert.equal(matches.length, 1);
  // Every schema referenced by the storefront path resolves after the
  // JSON round-trip (proves no runtime-only fields would break the wire spec).
  const refs: string[] = [];
  collectRefs(paths['/storefront/home'], refs);
  for (const ref of Array.from(new Set(refs))) {
    resolveRef(asJson, ref);
  }
});

// ── Runner ──────────────────────────────────────────────────────────
let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`✗ ${name}`);
    console.error(err);
  }
}
console.log(
  `\n${tests.length - failed}/${tests.length} passed` +
    (failed > 0 ? `, ${failed} failed` : ''),
);
process.exit(failed > 0 ? 1 : 0);
