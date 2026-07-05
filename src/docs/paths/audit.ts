import { bearerAuth, errorResponses, paginationQueryParams, success } from '../helpers';

export const auditPaths = {
  '/audit-logs': {
    get: {
      tags: ['Audit'],
      summary: 'List audit log entries (staff only, paginated)',
      description:
        'Records writes performed by staff — subscription cancels, plan changes, order verifications, etc.',
      security: bearerAuth,
      parameters: [
        ...paginationQueryParams,
        { in: 'query', name: 'actorId', schema: { type: 'string' } },
        { in: 'query', name: 'entityType', schema: { type: 'string' } },
        { in: 'query', name: 'entityId', schema: { type: 'string' } },
        { in: 'query', name: 'action', schema: { type: 'string' } },
      ],
      responses: {
        '200': success({
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: { $ref: '#/components/schemas/AuditLog' },
            },
            pagination: { $ref: '#/components/schemas/Pagination' },
          },
        }),
        '403': errorResponses['403'],
      },
    },
  },
};
