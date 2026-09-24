import { bearerAuth, errorResponses, paginationQueryParams, success } from '../helpers';

export const productPaths = {
  '/products': {
    get: {
      tags: ['Products'],
      summary: 'List / search products (public, paginated)',
      description:
        'Supports filtering by `categoryId`, `subcategoryId`, `brandId`, `search`, `isActive`, `isFeatured`. Sort with `sort` = `newest | priceAsc | priceDesc | popular`.\n\nAlso used by the marketplace cart to resolve current product names via `?ids=`. Without `lang`, `name`/`nameAr` (and the same on `category`/`subcategory`/`brand`) keep today\'s bilingual shape — this is what the admin product table relies on. When `lang` (`ar`|`en`) is passed, `name` is localized instead and `nameAr` is dropped, everywhere it appears.',
      parameters: [
        ...paginationQueryParams,
        { in: 'query', name: 'categoryId', schema: { type: 'string' } },
        { in: 'query', name: 'subcategoryId', schema: { type: 'string' } },
        { in: 'query', name: 'brandId', schema: { type: 'string' } },
        { in: 'query', name: 'search', schema: { type: 'string' } },
        { in: 'query', name: 'ids', schema: { type: 'string' }, description: 'Comma-separated product ids.' },
        {
          in: 'query',
          name: 'sort',
          schema: {
            type: 'string',
            enum: ['newest', 'priceAsc', 'priceDesc', 'popular'],
          },
        },
        { in: 'query', name: 'isFeatured', schema: { type: 'boolean' } },
        {
          in: 'query',
          name: 'lang',
          required: false,
          schema: { type: 'string', enum: ['ar', 'en'] },
          description: 'Opts into the marketplace-localized shape. Omit to get today\'s bilingual shape.',
        },
      ],
      responses: {
        '200': success({
          type: 'object',
          properties: {
            products: {
              type: 'array',
              items: { $ref: '#/components/schemas/Product' },
            },
            pagination: { $ref: '#/components/schemas/Pagination' },
          },
        }),
      },
    },
    post: {
      tags: ['Products'],
      summary: 'Create a product (staff only)',
      security: bearerAuth,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CreateProductRequest' },
          },
        },
      },
      responses: {
        '201': success({ $ref: '#/components/schemas/Product' }, 'Created'),
        '400': errorResponses['400'],
        '403': errorResponses['403'],
      },
    },
  },

  '/products/list': {
    post: {
      tags: ['Products'],
      summary: 'Marketplace product list (public, localized)',
      description:
        'Returns active products in the slim `MarketplaceProduct` shape (single localized `name` and `description`; nested `category`, `subcategory`, `brand` also localized). Legacy `GET /products` is kept for admin / backward compatibility.',
      requestBody: {
        required: false,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/MarketplaceProductListRequest' },
          },
        },
      },
      responses: {
        '200': success({
          type: 'object',
          required: ['products', 'pagination'],
          properties: {
            products: {
              type: 'array',
              items: { $ref: '#/components/schemas/MarketplaceProduct' },
            },
            pagination: { $ref: '#/components/schemas/Pagination' },
          },
        }),
      },
    },
  },

  '/products/detail': {
    post: {
      tags: ['Products'],
      summary: 'Marketplace product detail (public, localized)',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/MarketplaceProductDetailRequest' },
          },
        },
      },
      responses: {
        '200': success({ $ref: '#/components/schemas/MarketplaceProduct' }),
        '400': errorResponses['400'],
        '404': errorResponses['404'],
      },
    },
  },

  '/products/featured': {
    get: {
      tags: ['Products'],
      summary: 'Featured products (legacy public, bilingual)',
      description:
        'Legacy bilingual featured list. Prefer `POST /products/featured` for the new localized shape.',
      responses: {
        '200': success({
          type: 'array',
          items: { $ref: '#/components/schemas/Product' },
        }),
      },
    },
    post: {
      tags: ['Products'],
      summary: 'Marketplace featured products (public, localized)',
      requestBody: {
        required: false,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/MarketplaceFeaturedRequest' },
          },
        },
      },
      responses: {
        '200': success({
          type: 'array',
          items: { $ref: '#/components/schemas/MarketplaceProduct' },
        }),
      },
    },
  },

  '/products/search': {
    get: {
      tags: ['Products'],
      summary: 'Storefront search (legacy public, bilingual)',
      description: 'Legacy bilingual search. Prefer `POST /products/search` for the localized shape.',
      parameters: [
        { in: 'query', name: 'q', required: true, schema: { type: 'string' } },
        ...paginationQueryParams,
      ],
      responses: {
        '200': success({
          type: 'object',
          properties: {
            products: {
              type: 'array',
              items: { $ref: '#/components/schemas/Product' },
            },
            pagination: { $ref: '#/components/schemas/Pagination' },
          },
        }),
      },
    },
    post: {
      tags: ['Products'],
      summary: 'Marketplace search (public, localized)',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/MarketplaceSearchRequest' },
          },
        },
      },
      responses: {
        '200': success({
          type: 'object',
          required: ['products', 'matchedProductId', 'pagination'],
          properties: {
            products: {
              type: 'array',
              items: { $ref: '#/components/schemas/MarketplaceProduct' },
            },
            matchedProductId: { type: 'string', nullable: true },
            pagination: { $ref: '#/components/schemas/Pagination' },
          },
        }),
        '400': errorResponses['400'],
      },
    },
  },

  '/products/search/suggestions': {
    get: {
      tags: ['Products'],
      summary: 'Autocomplete suggestions (legacy public, bilingual)',
      description:
        'Legacy bilingual suggestions. Prefer `POST /products/search/suggestions` for the localized shape.',
      parameters: [{ in: 'query', name: 'q', required: true, schema: { type: 'string' } }],
      responses: {
        '200': success({
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              nameAr: { type: 'string' },
              imageUrl: { type: 'string', nullable: true },
            },
          },
        }),
      },
    },
    post: {
      tags: ['Products'],
      summary: 'Marketplace typeahead suggestions (public, localized)',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/MarketplaceSuggestionsRequest' },
          },
        },
      },
      responses: {
        '200': success({
          type: 'array',
          items: { $ref: '#/components/schemas/MarketplaceProductSuggestion' },
        }),
        '400': errorResponses['400'],
      },
    },
  },

  '/products/low-stock': {
    get: {
      tags: ['Products'],
      summary: 'Low-stock report (staff only)',
      security: bearerAuth,
      parameters: [
        {
          in: 'query',
          name: 'threshold',
          schema: { type: 'integer', default: 5 },
        },
      ],
      responses: {
        '200': success({
          type: 'array',
          items: { $ref: '#/components/schemas/Product' },
        }),
        '403': errorResponses['403'],
      },
    },
  },

  '/products/import/template': {
    get: {
      tags: ['Products'],
      summary: 'Download the product-import Excel template (staff only)',
      security: bearerAuth,
      responses: {
        '200': {
          description: 'XLSX template',
          content: {
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
              schema: { type: 'string', format: 'binary' },
            },
          },
        },
        '403': errorResponses['403'],
      },
    },
  },

  '/products/export/missing-images': {
    get: {
      tags: ['Products'],
      summary: 'Check the next batch of products for Cloudinary images and download those with none (staff only)',
      description:
        'Takes the next 500 products that have never been checked and looks for a Cloudinary image under `{sku}`, then `{sku}_1`, then `{barcode}`. Every product with a definitive answer is marked checked (`imageCheckedAt`, `imageFound`) and is never read again; a product Cloudinary could not answer for stays unchecked and is retried on the next call. Editing a product\'s sku or barcode returns it to the unchecked pool.\n\nReturns an XLSX (Product (Arabic), SKU, Barcode) of the batch\'s products with no image. When there is no file to give, returns JSON instead: `allChecked: true` once every product has been checked, or `missingCount: 0` when every product in the batch had an image.',
      security: bearerAuth,
      responses: {
        '200': {
          description: 'XLSX of products missing images, or a JSON status message',
          content: {
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
              schema: { type: 'string', format: 'binary' },
            },
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean' },
                  message: { type: 'string' },
                  data: {
                    type: 'object',
                    properties: {
                      allChecked: { type: 'boolean' },
                      missingCount: { type: 'integer', description: 'Present (0) when the batch had no missing images.' },
                      checked: { type: 'integer' },
                      unverified: { type: 'integer', description: 'Products Cloudinary could not answer for in this batch.' },
                      remaining: { type: 'integer' },
                      total: { type: 'integer' },
                    },
                  },
                },
              },
            },
          },
        },
        '400': errorResponses['400'],
        '401': errorResponses['401'],
        '403': errorResponses['403'],
      },
    },
  },

  '/products/export/missing-images/status': {
    get: {
      tags: ['Products'],
      summary: 'Progress of the Cloudinary image check (staff only)',
      security: bearerAuth,
      responses: {
        '200': success({
          type: 'object',
          properties: {
            total: { type: 'integer' },
            checked: { type: 'integer' },
            remaining: { type: 'integer' },
          },
        }),
        '401': errorResponses['401'],
        '403': errorResponses['403'],
      },
    },
  },

  '/products/import/excel': {
    post: {
      tags: ['Products'],
      summary: 'Bulk import products from Excel (staff only, multipart)',
      description:
        'Field name: `file`. Max 10 MB. The file must match the schema in the downloadable template.',
      security: bearerAuth,
      requestBody: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              required: ['file'],
              properties: {
                file: { type: 'string', format: 'binary' },
              },
            },
          },
        },
      },
      responses: {
        '200': success({
          type: 'object',
          properties: {
            created: { type: 'integer', example: 42 },
            updated: { type: 'integer', example: 3 },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  row: { type: 'integer' },
                  message: { type: 'string' },
                },
              },
            },
          },
        }),
        '400': errorResponses['400'],
        '403': errorResponses['403'],
      },
    },
  },

  '/products/{id}': {
    get: {
      tags: ['Products'],
      summary: 'Get a single product by id (public)',
      parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
      responses: {
        '200': success({ $ref: '#/components/schemas/Product' }),
        '404': errorResponses['404'],
      },
    },
    put: {
      tags: ['Products'],
      summary: 'Update a product (staff only)',
      security: bearerAuth,
      parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/UpdateProductRequest' },
          },
        },
      },
      responses: {
        '200': success({ $ref: '#/components/schemas/Product' }),
        '404': errorResponses['404'],
      },
    },
    delete: {
      tags: ['Products'],
      summary: 'Soft-delete or hard-delete a product (staff only)',
      security: bearerAuth,
      parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
      responses: {
        '200': success({ type: 'null' }, 'Deleted'),
        '404': errorResponses['404'],
      },
    },
  },

  '/products/{id}/status': {
    patch: {
      tags: ['Products'],
      summary: 'Toggle a product\'s active flag (staff only)',
      security: bearerAuth,
      parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ToggleStatusRequest' },
          },
        },
      },
      responses: {
        '200': success({ $ref: '#/components/schemas/Product' }),
        '404': errorResponses['404'],
      },
    },
  },

  '/products/{id}/stock': {
    patch: {
      tags: ['Products'],
      summary: 'Adjust product stock (staff only)',
      description: 'Send exactly one of `delta` (signed) or `set` (absolute overwrite).',
      security: bearerAuth,
      parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/AdjustStockRequest' },
          },
        },
      },
      responses: {
        '200': success({ $ref: '#/components/schemas/Product' }, 'Stock updated'),
        '400': errorResponses['400'],
        '404': errorResponses['404'],
      },
    },
  },
};
