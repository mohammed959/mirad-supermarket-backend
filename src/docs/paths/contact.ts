import { bearerAuth, errorResponses, success } from '../helpers';

const ContactSettings = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    phone: { type: 'string', nullable: true, example: '+966500000000' },
    whatsapp: { type: 'string', nullable: true, example: '+966500000000' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

export const contactPaths = {
  '/contact-us': {
    get: {
      tags: ['Contact'],
      summary: 'Get Mirad contact phone/WhatsApp numbers (public)',
      description: 'Read by the marketplace "Contact us" surface; no auth required. Either field may be `null` if the admin has not set it yet.',
      responses: {
        '200': success(ContactSettings),
      },
    },
    put: {
      tags: ['Contact'],
      summary: 'Update contact phone/WhatsApp numbers (staff only)',
      description: 'Managed from `/admin/settings`. Omit a field to leave it untouched; send `null` or `""` to clear it.',
      security: bearerAuth,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                phone: { type: 'string', nullable: true, example: '+966500000000' },
                whatsapp: { type: 'string', nullable: true, example: '+966500000000' },
              },
            },
          },
        },
      },
      responses: {
        '200': success(ContactSettings, 'Contact information saved'),
        '400': errorResponses['400'],
        '401': errorResponses['401'],
      },
    },
  },
};
