import { bearerAuth, errorResponses, paginationQueryParams, success } from '../helpers';

export const productPaths = {
  '/products': {
    get: {
      tags: ['Products'],
      summary: 'List / search products (public, paginated)',
      description:
        'Supports filtering by `categoryId`, `subcategoryId`, `brandId`, `search`, `isActive`, `isFeatured`. Sort with `sort` = `newest | priceAsc | priceDesc | popular`.',
      parameters: [
        ...paginationQueryParams,
        { in: 'query', name: 'categoryId', schema: { type: 'string' } },
        { in: 'query', name: 'subcategoryId', schema: { type: 'string' } },
        { in: 'query', name: 'brandId', schema: { type: 'string' } },
        { in: 'query', name: 'search', schema: { type: 'string' } },
        {
          in: 'query',
          name: 'sort',
          schema: {
            type: 'string',
            enum: ['newest', 'priceAsc', 'priceDesc', 'popular'],
          },
        },
        { in: 'query', name: 'isFeatured', schema: { type: 'boolean' } },
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

  '/products/featured': {
    get: {
      tags: ['Products'],
      summary: 'Featured products for the storefront home (public)',
      description: 'Returns products with `isFeatured=true` and `hideFromHome=false`.',
      responses: {
        '200': success({
          type: 'array',
          items: { $ref: '#/components/schemas/Product' },
        }),
      },
    },
  },

  '/products/search': {
    get: {
      tags: ['Products'],
      summary: 'Storefront search (public)',
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
  },

  '/products/search/suggestions': {
    get: {
      tags: ['Products'],
      summary: 'Autocomplete suggestions for search box (public)',
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
