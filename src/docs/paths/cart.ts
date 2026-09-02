import { bearerAuth, errorResponses, success } from '../helpers';

export const cartPaths = {
  '/cart': {
    get: {
      tags: ['Cart'],
      summary: 'Get the current customer\'s cart',
      security: bearerAuth,
      responses: {
        '200': success({ $ref: '#/components/schemas/Cart' }),
        '401': errorResponses['401'],
      },
    },
    delete: {
      tags: ['Cart'],
      summary: 'Clear the current customer\'s cart',
      security: bearerAuth,
      responses: {
        '204': { description: 'Cleared (no content)' },
        '401': errorResponses['401'],
      },
    },
  },

  '/cart/items': {
    post: {
      tags: ['Cart'],
      summary: 'Add or adjust a cart item',
      description:
        '`increment` adds `quantity` to whatever is already in the cart (creating the item if it\'s not there yet) and rejects with 400 if the result would exceed available stock. `decrement` subtracts `quantity`, removing the item once it reaches zero.',
      security: bearerAuth,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/AddOrAdjustCartItemRequest' },
            examples: {
              increment: { value: { productId: 'cku1a2b3c', quantity: 1, action: 'increment' } },
              decrement: { value: { productId: 'cku1a2b3c', quantity: 1, action: 'decrement' } },
            },
          },
        },
      },
      responses: {
        '200': success({
          oneOf: [
            { $ref: '#/components/schemas/CartItem' },
            { $ref: '#/components/schemas/CartItemRemoved' },
          ],
        }),
        '400': errorResponses['400'],
        '401': errorResponses['401'],
      },
    },
  },

  '/cart/items/{productId}': {
    delete: {
      tags: ['Cart'],
      summary: 'Remove a product from the cart',
      security: bearerAuth,
      parameters: [
        { in: 'path', name: 'productId', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '204': { description: 'Removed (no content)' },
        '401': errorResponses['401'],
      },
    },
  },
};
