import { bearerAuth, errorResponses, success } from '../helpers';

export const uploadPaths = {
  '/uploads/delivery-image': {
    post: {
      tags: ['Uploads'],
      summary: 'Upload a delivery-location image',
      description:
        'Customer-only. Multipart form-data with a single `file` field (JPG, PNG or WEBP, max 5 MB). The image is stored on the CDN and its public URL is returned — the client collects up to 3 of these and attaches the URLs to the order. No image bytes are stored in our database.',
      security: bearerAuth,
      requestBody: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              required: ['file'],
              properties: {
                file: {
                  type: 'string',
                  format: 'binary',
                  description: 'Image file (JPG / PNG / WEBP, <= 5 MB).',
                },
              },
            },
          },
        },
      },
      responses: {
        '200': success(
          {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                format: 'uri',
                example: 'https://apprafed.b-cdn.net/Customers/clx.../a1b2c3.webp',
              },
            },
          },
          'Image uploaded',
        ),
        '400': errorResponses['400'],
        '401': errorResponses['401'],
      },
    },
  },
};
