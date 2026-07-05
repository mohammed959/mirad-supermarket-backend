import { bearerAuth, errorResponses, success } from '../helpers';

export const favoritePaths = {
  '/favorites': {
    get: {
      tags: ['Favorites'],
      summary: 'List the current customer\'s favorite products',
      security: bearerAuth,
      responses: {
        '200': success({
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              productId: { type: 'string' },
              createdAt: { type: 'string', format: 'date-time' },
              product: { $ref: '#/components/schemas/Product' },
            },
          },
        }),
      },
    },
    post: {
      tags: ['Favorites'],
      summary: 'Add a product to favorites',
      security: bearerAuth,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['productId'],
              properties: { productId: { type: 'string' } },
            },
          },
        },
      },
      responses: {
        '201': success({
          type: 'object',
          properties: {
            id: { type: 'string' },
            productId: { type: 'string' },
          },
        }, 'Added'),
        '400': errorResponses['400'],
      },
    },
  },

  '/favorites/ids': {
    get: {
      tags: ['Favorites'],
      summary: 'Return only the productIds the customer has favorited',
      description: 'Optimised for storefront cards to render heart-filled state quickly.',
      security: bearerAuth,
      responses: {
        '200': success({
          type: 'array',
          items: { type: 'string' },
        }),
      },
    },
  },

  '/favorites/{productId}': {
    delete: {
      tags: ['Favorites'],
      summary: 'Remove a product from favorites',
      security: bearerAuth,
      parameters: [
        { in: 'path', name: 'productId', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '204': { description: 'Deleted (no content)' },
      },
    },
  },
};
