import { errorResponses, success } from '../helpers';

const homeExample = {
  success: true,
  message: 'Success',
  data: {
    categories: [
      {
        id: 'clw7cat1',
        name: 'الألبان والبيض',
        slug: 'dairy-eggs',
        imageUrl: 'https://cdn.example.net/category/dairy-eggs.png',
        sortOrder: 1,
        subCategories: [
          {
            id: 'clw7sub1',
            name: 'حليب',
            slug: 'dairy-milk',
            imageUrl: 'https://apprafed.b-cdn.net/Subcategories/6f1e0a2c-9c3d-4d21-b0e4-2a91d0f9b3ac.webp',
            sortOrder: 1,
          },
          {
            id: 'clw7sub2',
            name: 'جبن',
            slug: 'dairy-cheese',
            imageUrl: 'https://cdn.example.net/category/dairy-cheese.png',
            sortOrder: 2,
          },
        ],
      },
    ],
    banners: [
      {
        id: 'clw7ban1',
        title: 'Weekend Sale',
        titleAr: 'تخفيضات نهاية الأسبوع',
        imageUrl: 'https://cdn.example.net/banners/weekend.png',
        linkType: 'category',
        linkValue: 'clw7cat1',
        sortOrder: 1,
      },
    ],
    featuredProducts: [
      {
        id: 'clw7prod1',
        name: 'Almarai Full Cream Milk 1L',
        nameAr: 'حليب المراعي كامل الدسم 1 لتر',
        sku: 'ALM-MLK-1L',
        imageUrl: 'https://cdn.example.net/products/ALM-MLK-1L.png',
        price: '6.5',
        available: true,
      },
    ],
    featuredSections: [
      {
        id: 'clw7sec1',
        name: 'New Arrivals',
        nameAr: 'وصل حديثاً',
        sortOrder: 1,
        products: [
          {
            id: 'clw7prod1',
            name: 'Almarai Full Cream Milk 1L',
            nameAr: 'حليب المراعي كامل الدسم 1 لتر',
            sku: 'ALM-MLK-1L',
            imageUrl: 'https://cdn.example.net/products/ALM-MLK-1L.png',
            price: '6.5',
            available: true,
          },
        ],
      },
    ],
    allProducts: {
      items: [
        {
          id: 'clw7prod1',
          name: 'Almarai Full Cream Milk 1L',
          nameAr: 'حليب المراعي كامل الدسم 1 لتر',
          sku: 'ALM-MLK-1L',
          imageUrl: 'https://cdn.example.net/products/ALM-MLK-1L.png',
          price: '6.5',
          available: true,
        },
      ],
      hasMore: false,
    },
  },
};

// success() returns the standard envelope-wrapped response object;
// merge in a `headers` block to document the `Cache-Control: no-cache`
// the controller sets. Standard OpenAPI 3.0.3 supports response headers.
const homeSuccess = {
  ...success(
    { $ref: '#/components/schemas/StorefrontHomeAggregate' },
    'Success',
    homeExample,
  ),
  headers: {
    'Cache-Control': {
      description: [
        'Always `no-cache`.',
        '',
        '`no-cache` requires clients (and any intermediary proxies) to revalidate any locally-stored copy before reusing it — it does NOT forbid caching. Express\'s default weak `ETag` behavior remains enabled. When a client issues a conditional request (`If-None-Match` with an applicable validator) and the response is considered fresh by the server, it MAY receive `304 Not Modified`; otherwise it receives the full `200` body. This endpoint does not emit a custom `ETag` and does not guarantee a `304` on any specific request.',
      ].join('\n'),
      schema: { type: 'string', example: 'no-cache' },
    },
  },
};

export const storefrontPaths = {
  '/storefront/home': {
    post: {
      tags: ['Storefront'],
      summary: 'Aggregated public data for the marketplace homepage',
      description: [
        'Returns every public strip the marketplace home page renders in a single response so the frontend can paint the page from one request.',
        '',
        '**Method:** POST — the request body carries the language selector `{ lang }`.',
        '',
        '**Included (public, identical for guests and authenticated customers):**',
        '',
        '- `categories` — homepage-active category cards, ordered by `sortOrder`. `name` is localized per request-body `lang` (default `"ar"`). Each item carries its active subcategories under `subCategories` (also localized).',
        '- `banners` — active promotional banners, ordered by `sortOrder` then `createdAt`.',
        '- `featuredProducts` — up to 20 in-stock featured product cards.',
        '- `featuredSections` — curated sections and their in-stock product cards.',
        '- `allProducts` — first page of the browse-all strip, sized by the admin\'s `HomeSettings.allProductsLimit`.',
        '',
        '**Not included** (fetched separately from their own endpoints):',
        '',
        '- Buy Again',
        '- Addresses',
        '- Favorites',
        '- User profile',
        '- Delivery branch / coverage results',
        '',
        'Only category / subcategory names are localized today; product, section, and banner sections remain bilingual (each carries mirrored `name`/`nameAr` or `title`/`titleAr`).',
      ].join('\n'),
      requestBody: {
        required: false,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/StorefrontHomeRequest' },
          },
        },
      },
      responses: {
        '200': homeSuccess,
        '500': errorResponses['500'],
      },
    },
  },
};
