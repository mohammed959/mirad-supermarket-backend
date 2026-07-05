/**
 * Small helpers to keep the per-tag path files compact and consistent.
 * They render the same shapes used across the codebase (envelope, JWT
 * auth, standard error responses).
 */

export const bearerAuth = [{ bearerAuth: [] }];

export const errorResponses = {
  '400': {
    description: 'Validation failed / bad request',
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/ErrorResponse' },
        example: {
          success: false,
          message: 'title and body are required',
          errors: null,
        },
      },
    },
  },
  '401': {
    description: 'Missing or invalid Bearer token',
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/ErrorResponse' },
        example: { success: false, message: 'Unauthorized' },
      },
    },
  },
  '403': {
    description:
      'Authenticated but not authorized (wrong scope / role, e.g. customer token used on a staff endpoint).',
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/ErrorResponse' },
        example: { success: false, message: 'Staff session required' },
      },
    },
  },
  '404': {
    description: 'Entity not found',
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/ErrorResponse' },
        example: { success: false, message: 'Not found' },
      },
    },
  },
  '422': {
    description: 'Unprocessable — semantic validation error',
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/ErrorResponse' },
      },
    },
  },
  '500': {
    description: 'Internal server error',
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/ErrorResponse' },
        example: { success: false, message: 'Internal server error' },
      },
    },
  },
};

/**
 * Wrap a payload schema in the success envelope so every response the API
 * sends can be described without re-typing `success` / `message` fields.
 */
export function success(dataSchema: any, message = 'Success', example?: any) {
  return {
    description: 'Success',
    content: {
      'application/json': {
        schema: {
          allOf: [
            { $ref: '#/components/schemas/ApiSuccess' },
            {
              type: 'object',
              properties: { message: { example: message }, data: dataSchema },
            },
          ],
        },
        ...(example ? { example } : {}),
      },
    },
  };
}

export const paginationQueryParams = [
  {
    in: 'query',
    name: 'page',
    schema: { type: 'integer', default: 1, minimum: 1 },
    description: 'Page number (1-based).',
  },
  {
    in: 'query',
    name: 'limit',
    schema: { type: 'integer', default: 20, minimum: 1, maximum: 100 },
    description: 'Rows per page.',
  },
];
