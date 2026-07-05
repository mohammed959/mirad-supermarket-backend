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
    get: {
      tags: ['Categories'],
      summary: 'List all active categories (public)',
      responses: {
        '200': success({
          type: 'array',
          items: { $ref: '#/components/schemas/Category' },
        }),
      },
    },
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

  '/categories/{id}': {
    get: {
      tags: ['Categories'],
      summary: 'Get one category with its subcategories (public)',
      parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
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
