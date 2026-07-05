import { bearerAuth, errorResponses, success } from '../helpers';

const idParam = { in: 'path', name: 'id', required: true, schema: { type: 'string' } };

export const bannerPaths = {
  '/banners': {
    get: {
      tags: ['Banners'],
      summary: 'List active banners for the storefront home (public)',
      parameters: [
        { in: 'query', name: 'all', schema: { type: 'boolean' }, description: 'staff-only: include inactive' },
      ],
      responses: {
        '200': success({
          type: 'array',
          items: { $ref: '#/components/schemas/Banner' },
        }),
      },
    },
    post: {
      tags: ['Banners'],
      summary: 'Create a banner (staff only)',
      security: bearerAuth,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/UpsertBannerRequest' },
            example: {
              title: 'Weekend Sale',
              titleAr: 'تخفيضات نهاية الأسبوع',
              imageUrl: 'https://cdn.example.com/banners/weekend.png',
              linkType: 'category',
              linkValue: 'clw...cat-id',
              sortOrder: 1,
              isActive: true,
            },
          },
        },
      },
      responses: {
        '201': success({ $ref: '#/components/schemas/Banner' }, 'Created'),
        '400': errorResponses['400'],
      },
    },
  },

  '/banners/{id}': {
    get: {
      tags: ['Banners'],
      summary: 'Get a banner (public)',
      parameters: [idParam],
      responses: {
        '200': success({ $ref: '#/components/schemas/Banner' }),
        '404': errorResponses['404'],
      },
    },
    put: {
      tags: ['Banners'],
      summary: 'Update a banner (staff only)',
      security: bearerAuth,
      parameters: [idParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/UpsertBannerRequest' },
          },
        },
      },
      responses: {
        '200': success({ $ref: '#/components/schemas/Banner' }),
        '404': errorResponses['404'],
      },
    },
    delete: {
      tags: ['Banners'],
      summary: 'Delete a banner (staff only)',
      security: bearerAuth,
      parameters: [idParam],
      responses: {
        '204': { description: 'Deleted (no content)' },
        '404': errorResponses['404'],
      },
    },
  },

  '/banners/{id}/status': {
    patch: {
      tags: ['Banners'],
      summary: 'Toggle a banner\'s active flag (staff only)',
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
        '200': success({ $ref: '#/components/schemas/Banner' }),
      },
    },
  },
};
