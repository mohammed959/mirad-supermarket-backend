import { bearerAuth, errorResponses, success } from '../helpers';

export const customerPaths = {
  '/users/me': {
    patch: {
      tags: ['Profile', 'Customer'],
      summary: 'Update the current customer profile',
      security: bearerAuth,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/UpdateProfileRequest' },
            example: {
              name: 'Mohammed AlSoder',
              nameAr: 'محمد السدر',
              email: 'user@example.com',
            },
          },
        },
      },
      responses: {
        '200': success({ $ref: '#/components/schemas/Customer' }, 'Profile updated'),
        '401': errorResponses['401'],
        '403': errorResponses['403'],
      },
    },
  },

  '/users/me/addresses': {
    get: {
      tags: ['Customer', 'Addresses'],
      summary: 'List the current customer\'s addresses (convenience mirror)',
      description:
        'Convenience alias for `GET /api/addresses`. Returned rows use the shared `Address` schema.',
      security: bearerAuth,
      responses: {
        '200': success({
          type: 'array',
          items: { $ref: '#/components/schemas/Address' },
        }),
        '401': errorResponses['401'],
      },
    },
    post: {
      tags: ['Customer', 'Addresses'],
      summary: 'Add an address to the current customer',
      security: bearerAuth,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CreateAddressRequest' },
          },
        },
      },
      responses: {
        '201': success({ $ref: '#/components/schemas/Address' }, 'Created'),
        '400': errorResponses['400'],
        '401': errorResponses['401'],
      },
    },
  },

  '/users/me/addresses/{addressId}': {
    delete: {
      tags: ['Customer', 'Addresses'],
      summary: 'Delete an address belonging to the current customer',
      security: bearerAuth,
      parameters: [
        {
          in: 'path',
          name: 'addressId',
          required: true,
          schema: { type: 'string' },
        },
      ],
      responses: {
        '200': success({ type: 'null' }, 'Deleted'),
        '401': errorResponses['401'],
        '404': errorResponses['404'],
      },
    },
  },

  '/users': {
    get: {
      tags: ['Users (Admin)'],
      summary: 'List users (staff only)',
      description: 'Supports `page`, `limit`, `role`, `search` query params.',
      security: bearerAuth,
      parameters: [
        { in: 'query', name: 'page', schema: { type: 'integer', default: 1 } },
        { in: 'query', name: 'limit', schema: { type: 'integer', default: 20 } },
        { in: 'query', name: 'role', schema: { $ref: '#/components/schemas/Role' } },
        { in: 'query', name: 'search', schema: { type: 'string' } },
      ],
      responses: {
        '200': success({
          type: 'object',
          properties: {
            users: {
              type: 'array',
              items: { $ref: '#/components/schemas/Customer' },
            },
            pagination: { $ref: '#/components/schemas/Pagination' },
          },
        }),
        '401': errorResponses['401'],
        '403': errorResponses['403'],
      },
    },
    post: {
      tags: ['Users (Admin)'],
      summary: 'Create a customer user (staff only)',
      security: bearerAuth,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['mobile'],
              properties: {
                mobile: { type: 'string', example: '+966501234567' },
                name: { type: 'string' },
                nameAr: { type: 'string' },
                email: { type: 'string', format: 'email' },
              },
            },
          },
        },
      },
      responses: {
        '201': success({ $ref: '#/components/schemas/Customer' }, 'Created'),
        '400': errorResponses['400'],
        '401': errorResponses['401'],
      },
    },
  },

  '/users/staff': {
    post: {
      tags: ['Users (Admin)'],
      summary: 'Create a staff user (SUPER_ADMIN / PICKER / DRIVER)',
      security: bearerAuth,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CreateStaffRequest' },
          },
        },
      },
      responses: {
        '201': success({ $ref: '#/components/schemas/Customer' }, 'Created'),
        '400': errorResponses['400'],
        '403': errorResponses['403'],
      },
    },
  },

  '/users/{id}': {
    get: {
      tags: ['Users (Admin)'],
      summary: 'Get a user by id (staff only)',
      security: bearerAuth,
      parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
      responses: {
        '200': success({ $ref: '#/components/schemas/Customer' }),
        '404': errorResponses['404'],
        '403': errorResponses['403'],
      },
    },
  },

  '/users/{id}/role': {
    patch: {
      tags: ['Users (Admin)'],
      summary: 'Change a user\'s role',
      security: bearerAuth,
      parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/SetRoleRequest' },
          },
        },
      },
      responses: {
        '200': success({ $ref: '#/components/schemas/Customer' }),
        '403': errorResponses['403'],
        '404': errorResponses['404'],
      },
    },
  },

  '/users/{id}/status': {
    patch: {
      tags: ['Users (Admin)'],
      summary: 'Activate / deactivate a user',
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
        '200': success({ $ref: '#/components/schemas/Customer' }),
        '404': errorResponses['404'],
      },
    },
  },

  '/users/{id}/password': {
    patch: {
      tags: ['Users (Admin)'],
      summary: 'Reset a staff user\'s password',
      security: bearerAuth,
      parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ResetPasswordRequest' },
          },
        },
      },
      responses: {
        '200': success({ type: 'null' }, 'Password reset'),
        '400': errorResponses['400'],
        '403': errorResponses['403'],
        '404': errorResponses['404'],
      },
    },
  },
};
