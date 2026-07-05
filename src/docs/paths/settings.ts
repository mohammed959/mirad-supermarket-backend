import { bearerAuth, errorResponses, success } from '../helpers';

const HomeSettings = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    allProductsLimit: {
      type: 'integer',
      minimum: 1,
      maximum: 100,
      example: 20,
      description: 'How many products the storefront "All products" home section renders.',
    },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

export const settingsPaths = {
  '/settings/home': {
    get: {
      tags: ['Settings'],
      summary: 'Get storefront home settings (public)',
      description: 'Read by the marketplace home screen; no auth required.',
      responses: {
        '200': success(HomeSettings),
      },
    },
    put: {
      tags: ['Settings'],
      summary: 'Update storefront home settings (staff only)',
      security: bearerAuth,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                allProductsLimit: { type: 'integer', minimum: 1, maximum: 100, example: 24 },
              },
            },
          },
        },
      },
      responses: {
        '200': success(HomeSettings),
        '400': errorResponses['400'],
        '403': errorResponses['403'],
      },
    },
  },
};
