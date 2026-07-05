import { bearerAuth, errorResponses, success } from '../helpers';

export const brandPaths = {
  '/brands': {
    get: {
      tags: ['Brands'],
      summary: 'List brands (public)',
      parameters: [
        { in: 'query', name: 'activeOnly', schema: { type: 'boolean' } },
      ],
      responses: {
        '200': success({
          type: 'array',
          items: { $ref: '#/components/schemas/Brand' },
        }),
      },
    },
    post: {
      tags: ['Brands'],
      summary: 'Create a brand (staff only)',
      security: bearerAuth,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/UpsertBrandRequest' },
            example: {
              name: 'Almarai',
              nameAr: 'المراعي',
              slug: 'almarai',
              isActive: true,
              sortOrder: 1,
            },
          },
        },
      },
      responses: {
        '201': success({ $ref: '#/components/schemas/Brand' }, 'Created'),
        '400': errorResponses['400'],
      },
    },
  },

  '/brands/{id}': {
    get: {
      tags: ['Brands'],
      summary: 'Get one brand (public)',
      parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
      responses: {
        '200': success({ $ref: '#/components/schemas/Brand' }),
        '404': errorResponses['404'],
      },
    },
    put: {
      tags: ['Brands'],
      summary: 'Update a brand (staff only)',
      security: bearerAuth,
      parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/UpsertBrandRequest' },
          },
        },
      },
      responses: {
        '200': success({ $ref: '#/components/schemas/Brand' }),
        '404': errorResponses['404'],
      },
    },
    delete: {
      tags: ['Brands'],
      summary: 'Delete a brand (staff only)',
      security: bearerAuth,
      parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
      responses: {
        '200': success({ type: 'null' }, 'Deleted'),
        '404': errorResponses['404'],
      },
    },
  },
};
