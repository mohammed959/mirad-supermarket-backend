import { bearerAuth, errorResponses, success } from '../helpers';

export const categoryPaths = {
  '/categories/import/template': {
    get: {
      tags: ['Categories'],
      summary: 'Download the category-import Excel template (staff only)',
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

  '/categories/import/excel': {
    post: {
      tags: ['Categories'],
      summary: 'Bulk import categories from Excel (staff only, multipart)',
      description: 'Field name: `file`. The file must match the downloadable template schema.',
      security: bearerAuth,
      requestBody: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              required: ['file'],
              properties: { file: { type: 'string', format: 'binary' } },
            },
          },
        },
      },
      responses: {
        '200': success({
          type: 'object',
          properties: {
            created: { type: 'integer', example: 8 },
            updated: { type: 'integer', example: 2 },
            errors: { type: 'array', items: { type: 'string' } },
          },
        }),
        '400': errorResponses['400'],
        '403': errorResponses['403'],
      },
    },
  },

  '/categories': {
    post: {
      tags: ['Categories'],
      summary: 'Create a category (staff only)',
      security: bearerAuth,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/UpsertCategoryRequest' },
          },
        },
      },
      responses: {
        '201': success({ $ref: '#/components/schemas/Category' }, 'Created'),
        '400': errorResponses['400'],
        '403': errorResponses['403'],
      },
    },
  },

  '/categories/list': {
    post: {
      tags: ['Categories'],
      summary: 'Marketplace category list (public, localized)',
      description: [
        'Returns only active categories in the slim marketplace shape used by the customer app.',
        '',
        'Body:',
        '- `lang` (optional): `"ar"` or `"en"`. Missing / invalid values fall back to `"ar"`.',
        '',
        'Each item carries only `id`, `name` (localized), `slug`, `imageUrl`, `sortOrder`. Admin-only fields (`nameAr`, `isActive`, `showOnHome`, `createdAt`, `updatedAt`) and `subcategories` are intentionally omitted. Results are ordered by `sortOrder asc`.',
      ].join('\n'),
      requestBody: {
        required: false,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/MarketplaceCategoryListRequest' },
          },
        },
      },
      responses: {
        '200': success({
          type: 'array',
          items: { $ref: '#/components/schemas/MarketplaceCategoryCard' },
        }),
      },
    },
  },

  '/categories/admin': {
    get: {
      tags: ['Categories'],
      summary: 'Full category tree for admin (staff only)',
      description:
        'Returns the full historical category shape including `nameAr`, `isActive`, `showOnHome`, `createdAt`, `updatedAt`, and the nested `subcategories[]` array. Used by the admin category manager, promotion drawer, and other staff-side UIs.',
      security: bearerAuth,
      parameters: [
        {
          in: 'query',
          name: 'all',
          required: false,
          schema: { type: 'string', enum: ['true', 'false'] },
          description: 'When `"true"`, include inactive categories and inactive subcategories.',
        },
        {
          in: 'query',
          name: 'home',
          required: false,
          schema: { type: 'string', enum: ['true', 'false'] },
          description: 'When `"true"`, only categories flagged to show on the marketplace home.',
        },
      ],
      responses: {
        '200': success({
          type: 'array',
          items: { $ref: '#/components/schemas/Category' },
        }),
        '401': errorResponses['401'],
        '403': errorResponses['403'],
      },
    },
  },

  '/categories/{id}': {
    get: {
      tags: ['Categories'],
      summary: 'Get one category with its subcategories (public)',
      description:
        'Without `lang`, returns the full bilingual shape (`name` + `nameAr`, same on each subcategory) — this is what the admin product-list page relies on. When `lang` (`ar`|`en`) is passed, the response instead carries a single localized `name` on the category and each subcategory, and drops `nameAr` — this is what the marketplace uses.',
      parameters: [
        { in: 'path', name: 'id', required: true, schema: { type: 'string' } },
        {
          in: 'query',
          name: 'lang',
          required: false,
          schema: { type: 'string', enum: ['ar', 'en'] },
          description: 'Opts into the marketplace-localized response shape (single `name`, no `nameAr`). Omit to get today\'s bilingual shape.',
        },
      ],
      responses: {
        '200': success({ $ref: '#/components/schemas/Category' }),
        '404': errorResponses['404'],
      },
    },
    put: {
      tags: ['Categories'],
      summary: 'Replace a category (staff only)',
      security: bearerAuth,
      parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/UpsertCategoryRequest' },
          },
        },
      },
      responses: {
        '200': success({ $ref: '#/components/schemas/Category' }),
        '404': errorResponses['404'],
      },
    },
    delete: {
      tags: ['Categories'],
      summary: 'Delete a category (staff only)',
      security: bearerAuth,
      parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
      responses: {
        '200': success({ type: 'null' }, 'Deleted'),
        '404': errorResponses['404'],
      },
    },
  },

  '/categories/{id}/subcategories': {
    post: {
      tags: ['Categories'],
      summary: 'Create a subcategory under a category (staff only)',
      security: bearerAuth,
      parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/UpsertSubcategoryRequest' },
          },
        },
      },
      responses: {
        '201': success({ $ref: '#/components/schemas/Subcategory' }, 'Created'),
        '404': errorResponses['404'],
      },
    },
  },

  '/categories/{id}/subcategories/{subId}': {
    put: {
      tags: ['Categories'],
      summary: 'Replace a subcategory (staff only)',
      security: bearerAuth,
      parameters: [
        { in: 'path', name: 'id', required: true, schema: { type: 'string' } },
        { in: 'path', name: 'subId', required: true, schema: { type: 'string' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/UpsertSubcategoryRequest' },
          },
        },
      },
      responses: {
        '200': success({ $ref: '#/components/schemas/Subcategory' }),
        '404': errorResponses['404'],
      },
    },
    delete: {
      tags: ['Categories'],
      summary: 'Delete a subcategory (staff only)',
      security: bearerAuth,
      parameters: [
        { in: 'path', name: 'id', required: true, schema: { type: 'string' } },
        { in: 'path', name: 'subId', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': success({ type: 'null' }, 'Deleted'),
        '404': errorResponses['404'],
      },
    },
  },
};
