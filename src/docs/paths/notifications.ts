import { bearerAuth, errorResponses, success } from '../helpers';

export const notificationPaths = {
  '/notifications': {
    get: {
      tags: ['Notifications'],
      summary: 'List the current customer\'s notifications',
      security: bearerAuth,
      parameters: [
        { in: 'query', name: 'page', schema: { type: 'integer', default: 1 } },
      ],
      responses: {
        '200': success({
          type: 'object',
          properties: {
            notifications: {
              type: 'array',
              items: { $ref: '#/components/schemas/Notification' },
            },
            unreadCount: { type: 'integer', example: 3 },
            pagination: { $ref: '#/components/schemas/Pagination' },
          },
        }),
      },
    },
  },

  '/notifications/read-all': {
    patch: {
      tags: ['Notifications'],
      summary: 'Mark every notification as read (customer)',
      security: bearerAuth,
      responses: {
        '200': success({ type: 'null' }, 'Marked all as read'),
      },
    },
  },

  '/notifications/{id}/read': {
    patch: {
      tags: ['Notifications'],
      summary: 'Mark a single notification as read (customer)',
      security: bearerAuth,
      parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
      responses: {
        '200': success({ type: 'null' }, 'Marked as read'),
      },
    },
  },

  '/notifications/admin/send': {
    post: {
      tags: ['Notifications (Admin)'],
      summary: 'Broadcast a notification (staff only)',
      description:
        '`target=ALL_CUSTOMERS` sends to every customer. `target=USER` requires `userId`.',
      security: bearerAuth,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/BroadcastNotificationRequest' },
            example: {
              title: 'Weekend Sale',
              body: 'Up to 30% off all snacks.',
              type: 'PROMOTION_ACTIVATED',
              target: 'ALL_CUSTOMERS',
            },
          },
        },
      },
      responses: {
        '201': success({
          type: 'object',
          properties: {
            recipients: { type: 'integer', example: 1284 },
          },
        }, 'Sent to N recipient(s)'),
        '400': errorResponses['400'],
      },
    },
  },

  '/notifications/admin/history': {
    get: {
      tags: ['Notifications (Admin)'],
      summary: 'Broadcast history (staff only, paginated)',
      security: bearerAuth,
      parameters: [
        { in: 'query', name: 'type', schema: { $ref: '#/components/schemas/NotificationType' } },
        { in: 'query', name: 'page', schema: { type: 'integer', default: 1 } },
        { in: 'query', name: 'limit', schema: { type: 'integer', default: 30 } },
      ],
      responses: {
        '200': success({
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  key: { type: 'string' },
                  title: { type: 'string' },
                  body: { type: 'string' },
                  firstSentAt: { type: 'string', format: 'date-time' },
                  recipients: { type: 'integer' },
                },
              },
            },
            pagination: { $ref: '#/components/schemas/Pagination' },
          },
        }),
      },
    },
  },
};
