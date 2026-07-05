import { bearerAuth, errorResponses, success } from '../helpers';

export const subscriptionPaths = {
  '/subscriptions/plans': {
    get: {
      tags: ['Subscriptions'],
      summary: 'List active subscription plans (public)',
      responses: {
        '200': success({
          type: 'array',
          items: { $ref: '#/components/schemas/SubscriptionPlan' },
        }),
      },
    },
  },

  '/subscriptions/eligibility': {
    get: {
      tags: ['Subscriptions'],
      summary: 'Check whether the customer\'s address is inside the subscription coverage area (public)',
      parameters: [
        { in: 'query', name: 'lat', schema: { type: 'number' } },
        { in: 'query', name: 'lng', schema: { type: 'number' } },
      ],
      responses: {
        '200': success({
          type: 'object',
          properties: {
            eligible: { type: 'boolean', example: true },
            reason: { type: 'string', nullable: true },
            distanceKm: { type: 'number', nullable: true },
          },
        }),
      },
    },
  },

  '/subscriptions/subscribe': {
    post: {
      tags: ['Subscriptions'],
      summary: 'Subscribe to a plan (customer)',
      security: bearerAuth,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/SubscribeRequest' },
          },
        },
      },
      responses: {
        '201': success(
          { $ref: '#/components/schemas/CustomerSubscription' },
          'Subscription request submitted. Awaiting payment confirmation.',
        ),
        '400': errorResponses['400'],
        '401': errorResponses['401'],
      },
    },
  },

  '/subscriptions/my': {
    get: {
      tags: ['Subscriptions'],
      summary: 'Get the current customer\'s active subscription (customer)',
      security: bearerAuth,
      responses: {
        '200': success({
          oneOf: [{ $ref: '#/components/schemas/CustomerSubscription' }, { type: 'null' }],
        }),
        '401': errorResponses['401'],
      },
    },
  },

  '/subscriptions/cancel': {
    delete: {
      tags: ['Subscriptions'],
      summary: 'Customer cancels their own subscription',
      security: bearerAuth,
      responses: {
        '200': success({ type: 'null' }, 'Subscription cancelled'),
        '401': errorResponses['401'],
      },
    },
  },

  '/subscriptions/admin/plans': {
    get: {
      tags: ['Subscriptions (Admin)'],
      summary: 'List every plan with subscriber counts (staff only)',
      security: bearerAuth,
      responses: {
        '200': success({
          type: 'array',
          items: { $ref: '#/components/schemas/SubscriptionPlan' },
        }),
        '403': errorResponses['403'],
      },
    },
    post: {
      tags: ['Subscriptions (Admin)'],
      summary: 'Create a subscription plan (staff only)',
      security: bearerAuth,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CreatePlanRequest' },
          },
        },
      },
      responses: {
        '201': success({ $ref: '#/components/schemas/SubscriptionPlan' }, 'Created'),
        '400': errorResponses['400'],
      },
    },
  },

  '/subscriptions/admin/plans/{id}': {
    put: {
      tags: ['Subscriptions (Admin)'],
      summary: 'Update a plan (staff only)',
      security: bearerAuth,
      parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CreatePlanRequest' },
          },
        },
      },
      responses: {
        '200': success({ $ref: '#/components/schemas/SubscriptionPlan' }),
        '404': errorResponses['404'],
      },
    },
  },

  '/subscriptions/admin/plans/{id}/status': {
    patch: {
      tags: ['Subscriptions (Admin)'],
      summary: 'Activate / deactivate a plan (staff only)',
      description:
        'Deactivation is rejected with 400 when active subscribers exist. Admin must first remove customers from the plan via `DELETE /api/subscriptions/admin/{id}`.',
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
        '200': success({ $ref: '#/components/schemas/SubscriptionPlan' }),
        '400': errorResponses['400'],
      },
    },
  },

  '/subscriptions/admin/subscribers': {
    get: {
      tags: ['Subscriptions (Admin)'],
      summary: 'List customer subscriptions (staff only)',
      security: bearerAuth,
      parameters: [
        { in: 'query', name: 'page', schema: { type: 'integer', default: 1 } },
        { in: 'query', name: 'status', schema: { $ref: '#/components/schemas/SubscriptionStatus' } },
        { in: 'query', name: 'planId', schema: { type: 'string' } },
      ],
      responses: {
        '200': success({
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: { $ref: '#/components/schemas/CustomerSubscription' },
            },
            pagination: { $ref: '#/components/schemas/Pagination' },
          },
        }),
      },
    },
  },

  '/subscriptions/admin/{id}/confirm': {
    patch: {
      tags: ['Subscriptions (Admin)'],
      summary: 'Confirm a pending subscription (staff only)',
      security: bearerAuth,
      parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
      responses: {
        '200': success({ $ref: '#/components/schemas/CustomerSubscription' }, 'Subscription activated'),
      },
    },
  },

  '/subscriptions/admin/{id}': {
    delete: {
      tags: ['Subscriptions (Admin)'],
      summary: 'Cancel a customer subscription (staff only)',
      description:
        'Used by the admin "Remove" action on the Subscribers tab (requires a confirmation step in the UI).',
      security: bearerAuth,
      parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
      responses: {
        '200': success({ $ref: '#/components/schemas/CustomerSubscription' }, 'Subscription cancelled'),
        '400': errorResponses['400'],
      },
    },
  },
};
