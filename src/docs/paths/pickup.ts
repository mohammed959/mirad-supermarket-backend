import { bearerAuth, errorResponses, success } from '../helpers';

const idParam = { in: 'path', name: 'id', required: true, schema: { type: 'string' } };

export const pickupPaths = {
  '/pickup/public-settings': {
    get: {
      tags: ['Pickup'],
      summary: 'Public pickup feature flags (used to hide the "Schedule" toggle)',
      responses: {
        '200': success({
          type: 'object',
          properties: {
            futurePickupEnabled: { type: 'boolean' },
            maxReservationDays: { type: 'integer' },
            cutoffTime: { type: 'string', nullable: true },
            slotCount: { type: 'integer', example: 4 },
          },
        }),
      },
    },
  },

  '/pickup/settings': {
    get: {
      tags: ['Pickup'],
      summary: 'Get pickup admin settings (staff only)',
      security: bearerAuth,
      responses: {
        '200': success({ $ref: '#/components/schemas/PickupSettings' }),
      },
    },
    patch: {
      tags: ['Pickup'],
      summary: 'Update pickup admin settings (staff only)',
      security: bearerAuth,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/PickupSettings' },
          },
        },
      },
      responses: {
        '200': success({ $ref: '#/components/schemas/PickupSettings' }),
        '400': errorResponses['400'],
      },
    },
  },

  '/pickup/slots': {
    get: {
      tags: ['Pickup'],
      summary: 'List pickup time slots (staff only)',
      security: bearerAuth,
      parameters: [
        { in: 'query', name: 'all', schema: { type: 'boolean' } },
      ],
      responses: {
        '200': success({
          type: 'array',
          items: { $ref: '#/components/schemas/PickupSlot' },
        }),
      },
    },
    post: {
      tags: ['Pickup'],
      summary: 'Create a pickup time slot (staff only)',
      security: bearerAuth,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/UpsertPickupSlotRequest' },
          },
        },
      },
      responses: {
        '201': success({ $ref: '#/components/schemas/PickupSlot' }, 'Created'),
        '400': errorResponses['400'],
      },
    },
  },

  '/pickup/slots/{id}': {
    put: {
      tags: ['Pickup'],
      summary: 'Update a pickup time slot (staff only)',
      security: bearerAuth,
      parameters: [idParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/UpsertPickupSlotRequest' },
          },
        },
      },
      responses: {
        '200': success({ $ref: '#/components/schemas/PickupSlot' }),
        '404': errorResponses['404'],
      },
    },
    delete: {
      tags: ['Pickup'],
      summary: 'Delete a pickup time slot (staff only)',
      description:
        'If the slot has upcoming reservations, the backend disables it instead of deleting and returns `{ disabledInsteadOfDeleted: true }`.',
      security: bearerAuth,
      parameters: [idParam],
      responses: {
        '200': success({
          type: 'object',
          properties: {
            disabledInsteadOfDeleted: { type: 'boolean', example: false },
          },
        }, 'Deleted'),
      },
    },
  },
};
