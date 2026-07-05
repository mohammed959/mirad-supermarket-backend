import { bearerAuth, errorResponses, success } from '../helpers';

const idParam = { in: 'path', name: 'id', required: true, schema: { type: 'string' } };

export const addressPaths = {
  '/addresses': {
    get: {
      tags: ['Addresses'],
      summary: 'List the customer\'s addresses',
      security: bearerAuth,
      responses: {
        '200': success({
          type: 'array',
          items: { $ref: '#/components/schemas/Address' },
        }),
      },
    },
    post: {
      tags: ['Addresses'],
      summary: 'Create a new address',
      security: bearerAuth,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CreateAddressRequest' },
            example: {
              label: 'Home',
              addressLine: 'King Fahd Rd, Riyadh 12271',
              city: 'Riyadh',
              latitude: 24.7136,
              longitude: 46.6753,
              isDefault: true,
            },
          },
        },
      },
      responses: {
        '201': success({ $ref: '#/components/schemas/Address' }, 'Created'),
        '400': errorResponses['400'],
      },
    },
  },

  '/addresses/{id}': {
    get: {
      tags: ['Addresses'],
      summary: 'Get a single address',
      security: bearerAuth,
      parameters: [idParam],
      responses: {
        '200': success({ $ref: '#/components/schemas/Address' }),
        '404': errorResponses['404'],
      },
    },
    put: {
      tags: ['Addresses'],
      summary: 'Update an address',
      security: bearerAuth,
      parameters: [idParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/UpdateAddressRequest' },
          },
        },
      },
      responses: {
        '200': success({ $ref: '#/components/schemas/Address' }),
        '404': errorResponses['404'],
      },
    },
    delete: {
      tags: ['Addresses'],
      summary: 'Delete an address',
      security: bearerAuth,
      parameters: [idParam],
      responses: {
        '204': { description: 'Deleted (no content)' },
        '404': errorResponses['404'],
      },
    },
  },

  '/addresses/{id}/default': {
    patch: {
      tags: ['Addresses'],
      summary: 'Set an address as the default',
      security: bearerAuth,
      parameters: [idParam],
      responses: {
        '200': success({ $ref: '#/components/schemas/Address' }),
        '404': errorResponses['404'],
      },
    },
  },
};
