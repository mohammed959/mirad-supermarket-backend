import { bearerAuth, errorResponses, paginationQueryParams, success } from '../helpers';

const idParam = { in: 'path', name: 'id', required: true, schema: { type: 'string' } };

export const promotionPaths = {
  '/promotions/for-product/{productId}': {
    get: {
      tags: ['Promotions'],
      summary: 'Promotions that currently apply to a product (public)',
      description: 'Used by product cards to render "3 for the price of 2" style callouts.',
      parameters: [
        { in: 'path', name: 'productId', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': success({
          type: 'array',
          items: { $ref: '#/components/schemas/Promotion' },
        }),
      },
    },
  },

  '/promotions': {
    get: {
      tags: ['Promotions'],
      summary: 'List promotions (staff only, paginated)',
      security: bearerAuth,
      parameters: [
        ...paginationQueryParams,
        { in: 'query', name: 'active', schema: { type: 'boolean' } },
        { in: 'query', name: 'type', schema: { $ref: '#/components/schemas/PromotionType' } },
        { in: 'query', name: 'q', schema: { type: 'string' } },
        { in: 'query', name: 'includeArchived', schema: { type: 'boolean' } },
      ],
      responses: {
        '200': success({
          type: 'object',
          properties: {
            promotions: {
              type: 'array',
              items: { $ref: '#/components/schemas/Promotion' },
            },
            pagination: { $ref: '#/components/schemas/Pagination' },
          },
        }),
        '403': errorResponses['403'],
      },
    },
    post: {
      tags: ['Promotions'],
      summary: 'Create a promotion (staff only)',
      security: bearerAuth,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/UpsertPromotionRequest' },
          },
        },
      },
      responses: {
        '201': success({ $ref: '#/components/schemas/Promotion' }, 'Created'),
        '400': errorResponses['400'],
      },
    },
  },

  '/promotions/{id}': {
    get: {
      tags: ['Promotions'],
      summary: 'Get one promotion with its targeting (staff only)',
      security: bearerAuth,
      parameters: [idParam],
      responses: {
        '200': success({ $ref: '#/components/schemas/Promotion' }),
        '404': errorResponses['404'],
      },
    },
    put: {
      tags: ['Promotions'],
      summary: 'Update a promotion (staff only)',
      security: bearerAuth,
      parameters: [idParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/UpsertPromotionRequest' },
          },
        },
      },
      responses: {
        '200': success({ $ref: '#/components/schemas/Promotion' }),
        '400': errorResponses['400'],
      },
    },
  },

  '/promotions/{id}/status': {
    patch: {
      tags: ['Promotions'],
      summary: 'Toggle a promotion\'s active flag (staff only)',
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
        '200': success({ $ref: '#/components/schemas/Promotion' }),
      },
    },
  },

  '/promotions/{id}/archive': {
    patch: {
      tags: ['Promotions'],
      summary: 'Archive a promotion (staff only)',
      security: bearerAuth,
      parameters: [idParam],
      responses: {
        '200': success({ $ref: '#/components/schemas/Promotion' }, 'Archived'),
      },
    },
  },
};
