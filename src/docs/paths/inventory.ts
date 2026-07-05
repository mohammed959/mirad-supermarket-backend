import { bearerAuth, errorResponses, success } from '../helpers';

export const inventoryPaths = {
  '/inventory-bulk/template': {
    get: {
      tags: ['Inventory'],
      summary: 'Download the bulk SKU update template (staff only, XLSX)',
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

  '/inventory-bulk/preview': {
    post: {
      tags: ['Inventory'],
      summary: 'Preview the effect of a bulk SKU update file (staff only)',
      description:
        'Field name: `file`. Parses and validates rows; returns a diff without writing anything.',
      security: bearerAuth,
      requestBody: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              required: ['file'],
              properties: {
                file: { type: 'string', format: 'binary' },
              },
            },
          },
        },
      },
      responses: {
        '200': success({
          type: 'object',
          properties: {
            rows: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  sku: { type: 'string' },
                  price: { type: 'number', nullable: true },
                  quantity: { type: 'integer', nullable: true },
                  currentPrice: { type: 'number', nullable: true },
                  currentQuantity: { type: 'integer', nullable: true },
                  status: {
                    type: 'string',
                    enum: ['OK', 'MISSING_SKU', 'NO_CHANGE', 'INVALID_VALUE'],
                  },
                  message: { type: 'string', nullable: true },
                },
              },
            },
          },
        }),
        '400': errorResponses['400'],
      },
    },
  },

  '/inventory-bulk/apply': {
    post: {
      tags: ['Inventory'],
      summary: 'Apply a validated bulk SKU update (staff only)',
      description:
        'Provide the rows you previewed. Each row must include `sku`; `price` and `quantity` are optional but at least one must be provided.',
      security: bearerAuth,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['rows'],
              properties: {
                rows: {
                  type: 'array',
                  minItems: 1,
                  items: {
                    type: 'object',
                    required: ['sku'],
                    properties: {
                      sku: { type: 'string', example: 'ALM-MLK-1L' },
                      price: { type: 'number', example: 6.75 },
                      quantity: { type: 'integer', example: 150 },
                    },
                  },
                },
              },
            },
          },
        },
      },
      responses: {
        '200': success({
          type: 'object',
          properties: {
            appliedCount: { type: 'integer', example: 42 },
          },
        }, 'Applied'),
        '400': errorResponses['400'],
      },
    },
  },
};
