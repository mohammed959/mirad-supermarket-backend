import { bearerAuth, errorResponses, paginationQueryParams, success } from '../helpers';

const orderIdParam = {
  in: 'path',
  name: 'id',
  required: true,
  schema: { type: 'string' },
};

const itemIdParam = {
  in: 'path',
  name: 'itemId',
  required: true,
  schema: { type: 'string' },
};

export const orderPaths = {
  '/orders': {
    get: {
      tags: ['Orders'],
      summary: 'List orders — customer sees own; staff sees all (paginated)',
      description:
        'Customer JWT → returns only that customer\'s orders. Staff JWT → returns every order visible to the caller\'s role.',
      security: bearerAuth,
      parameters: [
        ...paginationQueryParams,
        { in: 'query', name: 'status', schema: { $ref: '#/components/schemas/OrderStatus' } },
        { in: 'query', name: 'fulfillmentType', schema: { $ref: '#/components/schemas/FulfillmentType' } },
      ],
      responses: {
        '200': success({
          type: 'object',
          properties: {
            orders: { type: 'array', items: { $ref: '#/components/schemas/Order' } },
            pagination: { $ref: '#/components/schemas/Pagination' },
          },
        }),
        '401': errorResponses['401'],
      },
    },
    post: {
      tags: ['Orders'],
      summary: 'Create an order (customer only)',
      security: bearerAuth,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CreateOrderRequest' },
            example: {
              fulfillmentType: 'DELIVERY',
              addressId: 'clw...',
              paymentMethod: 'CASH_ON_DELIVERY',
              notes: 'Please leave at the door',
              items: [{ productId: 'clw...', quantity: 2 }],
            },
          },
        },
      },
      responses: {
        '201': success({ $ref: '#/components/schemas/Order' }, 'Order created'),
        '400': errorResponses['400'],
        '403': errorResponses['403'],
      },
    },
  },

  '/orders/stats': {
    get: {
      tags: ['Orders'],
      summary: 'Admin dashboard totals (staff only)',
      security: bearerAuth,
      responses: {
        '200': success({
          type: 'object',
          properties: {
            todayCount: { type: 'integer' },
            todayRevenue: { type: 'number' },
            pendingCount: { type: 'integer' },
            inProgressCount: { type: 'integer' },
          },
        }),
        '403': errorResponses['403'],
      },
    },
  },

  '/orders/admin/today': {
    get: {
      tags: ['Orders'],
      summary: 'Admin — orders scheduled or created today (staff only)',
      security: bearerAuth,
      responses: {
        '200': success({
          type: 'array',
          items: { $ref: '#/components/schemas/Order' },
        }),
      },
    },
  },
  '/orders/admin/other': {
    get: {
      tags: ['Orders'],
      summary: 'Admin — orders neither today nor scheduled ahead (staff only)',
      security: bearerAuth,
      responses: {
        '200': success({
          type: 'array',
          items: { $ref: '#/components/schemas/Order' },
        }),
      },
    },
  },
  '/orders/admin/future': {
    get: {
      tags: ['Orders'],
      summary: 'Admin — scheduled-pickup orders in the future (staff only)',
      security: bearerAuth,
      responses: {
        '200': success({
          type: 'array',
          items: { $ref: '#/components/schemas/Order' },
        }),
      },
    },
  },

  '/orders/buy-again': {
    get: {
      tags: ['Orders'],
      summary: 'Buy-again product strip for the customer home screen',
      description: 'Distinct products ordered by the current customer, most-recent first.',
      security: bearerAuth,
      responses: {
        '200': success({
          type: 'array',
          items: { $ref: '#/components/schemas/Product' },
        }),
      },
    },
  },

  '/orders/{id}': {
    get: {
      tags: ['Orders'],
      summary: 'Get one order by id (customer or staff)',
      security: bearerAuth,
      parameters: [orderIdParam],
      responses: {
        '200': success({ $ref: '#/components/schemas/Order' }),
        '403': errorResponses['403'],
        '404': errorResponses['404'],
      },
    },
  },

  '/orders/{id}/reorder': {
    post: {
      tags: ['Orders'],
      summary: 'Reorder — re-add this order\'s items to the customer\'s cart',
      security: bearerAuth,
      parameters: [orderIdParam],
      responses: {
        '200': success({
          type: 'object',
          properties: {
            addedItems: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  productId: { type: 'string' },
                  quantity: { type: 'integer' },
                },
              },
            },
          },
        }, 'Items added to cart'),
      },
    },
  },

  '/orders/{id}/cancel': {
    post: {
      tags: ['Orders'],
      summary: 'Customer cancels their own order',
      description: 'Only allowed while the order status is `NEW` or `PAYMENT_VERIFIED`.',
      security: bearerAuth,
      parameters: [orderIdParam],
      responses: {
        '200': success({ $ref: '#/components/schemas/Order' }, 'Cancelled'),
        '400': errorResponses['400'],
        '404': errorResponses['404'],
      },
    },
  },

  '/orders/{id}/payment-proof': {
    post: {
      tags: ['Orders', 'Payments'],
      summary: 'Upload payment proof (customer, multipart)',
      description: 'Field name: `file`. Used for BANK_TRANSFER orders awaiting admin verification.',
      security: bearerAuth,
      parameters: [orderIdParam],
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
        '200': success({ $ref: '#/components/schemas/Order' }, 'Payment proof uploaded'),
        '400': errorResponses['400'],
      },
    },
  },

  '/orders/{id}/car-pickup-details': {
    patch: {
      tags: ['Orders'],
      summary: 'Set / update curbside pickup car details (customer)',
      description:
        'Populates optional plate/brand/color/note fields so branch staff can bring the order to the customer\'s car. Drivers never see these fields.',
      security: bearerAuth,
      parameters: [orderIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CarPickupDetailsRequest' },
          },
        },
      },
      responses: {
        '200': success({ $ref: '#/components/schemas/Order' }),
      },
    },
    delete: {
      tags: ['Orders'],
      summary: 'Clear curbside pickup car details (customer)',
      security: bearerAuth,
      parameters: [orderIdParam],
      responses: {
        '200': success({ $ref: '#/components/schemas/Order' }, 'Cleared'),
      },
    },
  },

  '/orders/{id}/status': {
    patch: {
      tags: ['Orders'],
      summary: 'Change order status (staff — role-gated by target transition)',
      security: bearerAuth,
      parameters: [orderIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/UpdateStatusRequest' },
          },
        },
      },
      responses: {
        '200': success({ $ref: '#/components/schemas/Order' }, 'Status updated'),
        '400': errorResponses['400'],
        '403': errorResponses['403'],
      },
    },
  },

  '/orders/{id}/assign-picker': {
    patch: {
      tags: ['Orders'],
      summary: 'Assign a picker to an order (SUPER_ADMIN only)',
      security: bearerAuth,
      parameters: [orderIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/AssignPickerRequest' },
          },
        },
      },
      responses: {
        '200': success({ $ref: '#/components/schemas/Order' }, 'Picker assigned'),
        '403': errorResponses['403'],
      },
    },
  },
  '/orders/{id}/assign-driver': {
    patch: {
      tags: ['Orders'],
      summary: 'Assign a driver to an order (SUPER_ADMIN only)',
      security: bearerAuth,
      parameters: [orderIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/AssignDriverRequest' },
          },
        },
      },
      responses: {
        '200': success({ $ref: '#/components/schemas/Order' }, 'Driver assigned'),
        '403': errorResponses['403'],
      },
    },
  },
  '/orders/{id}/reject': {
    patch: {
      tags: ['Orders'],
      summary: 'Reject an order with a reason (SUPER_ADMIN only)',
      security: bearerAuth,
      parameters: [orderIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/RejectOrderRequest' },
          },
        },
      },
      responses: {
        '200': success({ $ref: '#/components/schemas/Order' }, 'Rejected'),
        '403': errorResponses['403'],
      },
    },
  },
  '/orders/{id}/payment-verify': {
    patch: {
      tags: ['Orders', 'Payments'],
      summary: 'Verify (approve) a bank-transfer payment (SUPER_ADMIN only)',
      security: bearerAuth,
      parameters: [orderIdParam],
      responses: {
        '200': success({ $ref: '#/components/schemas/Order' }, 'Payment verified'),
        '403': errorResponses['403'],
      },
    },
  },

  '/orders/{id}/items/{itemId}/status': {
    patch: {
      tags: ['Orders'],
      summary: 'Picker/admin — set an item\'s pick status (PICKED / UNAVAILABLE / REMOVED)',
      security: bearerAuth,
      parameters: [orderIdParam, itemIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/SetItemStatusRequest' },
          },
        },
      },
      responses: {
        '200': success({ $ref: '#/components/schemas/OrderItem' }),
        '403': errorResponses['403'],
      },
    },
  },

  '/orders/{id}/items/{itemId}/replace': {
    post: {
      tags: ['Orders'],
      summary: 'Picker/admin — replace an unavailable item with another product',
      security: bearerAuth,
      parameters: [orderIdParam, itemIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ReplaceItemRequest' },
          },
        },
      },
      responses: {
        '200': success({ $ref: '#/components/schemas/OrderItem' }),
        '400': errorResponses['400'],
        '403': errorResponses['403'],
      },
    },
  },

  '/orders/{id}/items/{itemId}/reset': {
    post: {
      tags: ['Orders'],
      summary: 'Picker/admin — undo an item action (revert to pending)',
      description: 'Cancels a prior pick/replace/unavailable action on the item. Roles: PICKER, SUPER_ADMIN.',
      security: bearerAuth,
      parameters: [orderIdParam, itemIdParam],
      responses: {
        '200': success({ $ref: '#/components/schemas/OrderItem' }, 'Item action cancelled'),
        '400': errorResponses['400'],
        '403': errorResponses['403'],
      },
    },
  },

  '/orders/{id}/delivery-images': {
    patch: {
      tags: ['Orders'],
      summary: 'Customer — attach delivery-location image URLs to the order',
      description:
        'Send up to 3 image URLs previously obtained from `POST /uploads/delivery-image`. Only the order owner may call this.',
      security: bearerAuth,
      parameters: [orderIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['images'],
              properties: {
                images: {
                  type: 'array',
                  maxItems: 3,
                  items: { type: 'string', format: 'uri' },
                  example: ['https://apprafed.b-cdn.net/Customers/clx.../a1.webp'],
                },
              },
            },
          },
        },
      },
      responses: {
        '200': success({ $ref: '#/components/schemas/Order' }, 'Delivery location images updated'),
        '400': errorResponses['400'],
        '401': errorResponses['401'],
      },
    },
  },

  '/orders/{id}/confirm-received': {
    patch: {
      tags: ['Orders'],
      summary: 'Driver/admin — confirm the order was received by the customer',
      description: 'Roles: DRIVER, SUPER_ADMIN.',
      security: bearerAuth,
      parameters: [orderIdParam],
      responses: {
        '200': success({ $ref: '#/components/schemas/Order' }),
        '403': errorResponses['403'],
        '404': errorResponses['404'],
      },
    },
  },
};
