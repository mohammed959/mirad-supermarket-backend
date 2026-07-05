import { bearerAuth, errorResponses, success } from '../helpers';

const idParam = { in: 'path', name: 'id', required: true, schema: { type: 'string' } };
const productIdParam = {
  in: 'path',
  name: 'productId',
  required: true,
  schema: { type: 'string' },
};
const itemIdParam = {
  in: 'path',
  name: 'itemId',
  required: true,
  schema: { type: 'string' },
};

export const featuredSectionPaths = {
  '/featured-sections': {
    get: {
      tags: ['Featured Sections'],
      summary: 'List active featured sections (public)',
      responses: {
        '200': success({
          type: 'array',
          items: { $ref: '#/components/schemas/FeaturedSection' },
        }),
      },
    },
    post: {
      tags: ['Featured Sections'],
      summary: 'Create a featured section (staff only)',
      security: bearerAuth,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/UpsertFeaturedSectionRequest' },
          },
        },
      },
      responses: {
        '201': success({ $ref: '#/components/schemas/FeaturedSection' }, 'Created'),
        '400': errorResponses['400'],
      },
    },
  },

  '/featured-sections/{id}': {
    get: {
      tags: ['Featured Sections'],
      summary: 'Get one section (public)',
      parameters: [idParam],
      responses: {
        '200': success({ $ref: '#/components/schemas/FeaturedSection' }),
        '404': errorResponses['404'],
      },
    },
    put: {
      tags: ['Featured Sections'],
      summary: 'Update a section (staff only)',
      security: bearerAuth,
      parameters: [idParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/UpsertFeaturedSectionRequest' },
          },
        },
      },
      responses: {
        '200': success({ $ref: '#/components/schemas/FeaturedSection' }),
      },
    },
    delete: {
      tags: ['Featured Sections'],
      summary: 'Delete a section (staff only)',
      security: bearerAuth,
      parameters: [idParam],
      responses: {
        '204': { description: 'Deleted (no content)' },
      },
    },
  },

  '/featured-sections/{id}/status': {
    patch: {
      tags: ['Featured Sections'],
      summary: 'Toggle a section\'s active flag (staff only)',
      security: bearerAuth,
      parameters: [idParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ToggleStatusRequest' },
          },
        },
      },
      responses: {
        '200': success({ $ref: '#/components/schemas/FeaturedSection' }),
      },
    },
  },

  '/featured-sections/{id}/products': {
    post: {
      tags: ['Featured Sections'],
      summary: 'Add products to a section (staff only)',
      security: bearerAuth,
      parameters: [idParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/AddProductsToSectionRequest' },
          },
        },
      },
      responses: {
        '201': success({
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              productId: { type: 'string' },
              sortOrder: { type: 'integer' },
            },
          },
        }, 'Products added'),
      },
    },
  },

  '/featured-sections/{id}/products/{productId}': {
    delete: {
      tags: ['Featured Sections'],
      summary: 'Remove a product from a section (staff only)',
      security: bearerAuth,
      parameters: [idParam, productIdParam],
      responses: {
        '204': { description: 'Removed (no content)' },
      },
    },
  },

  '/featured-sections/{id}/items/{itemId}/reorder': {
    patch: {
      tags: ['Featured Sections'],
      summary: 'Shift a section item up/down by 1 (staff only)',
      security: bearerAuth,
      parameters: [idParam, itemIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['delta'],
              properties: {
                delta: { type: 'integer', enum: [-1, 1] },
              },
            },
          },
        },
      },
      responses: {
        '200': success({
          type: 'object',
          properties: {
            id: { type: 'string' },
            productId: { type: 'string' },
            sortOrder: { type: 'integer' },
          },
        }),
        '400': errorResponses['400'],
      },
    },
  },
};
