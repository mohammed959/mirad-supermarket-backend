import { bearerAuth, errorResponses, success } from '../helpers';

export const deliveryPaths = {
  '/delivery/calculate-fee': {
    post: {
      tags: ['Delivery'],
      summary: 'Compute delivery fee for the customer\'s cart',
      description:
        'Optional bearer — if omitted, subscription benefits are ignored. Equivalent to `/api/checkout/calculate-delivery`.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/DeliveryQuoteRequest' },
          },
        },
      },
      responses: {
        '200': success({ $ref: '#/components/schemas/DeliveryQuoteResponse' }),
        '400': errorResponses['400'],
      },
    },
  },

  '/delivery/quote': {
    post: {
      tags: ['Delivery'],
      summary: 'Detailed delivery quote (distance, rule, subscription info)',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/DeliveryQuoteRequest' },
          },
        },
      },
      responses: {
        '200': success({ $ref: '#/components/schemas/DeliveryQuoteResponse' }),
      },
    },
  },

  '/delivery/check-coverage': {
    post: {
      tags: ['Delivery'],
      summary: 'Check if a location is inside a supported city (public)',
      description:
        'Marketplace-access gate. No auth — customers hit this on their first visit, before login, to confirm they are inside a served city. Purely geographic; independent of delivery pricing. Callers should FAIL OPEN when `configured` is false.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/LatLng' },
            example: { lat: 25.795, lng: 44.068 },
          },
        },
      },
      responses: {
        '200': success(
          { $ref: '#/components/schemas/CoverageResult' },
          'Success',
          {
            success: true,
            message: 'Success',
            data: {
              configured: true,
              covered: true,
              area: { name: 'Riyadh Al Khabra', nameAr: 'رياض الخبراء' },
            },
          },
        ),
        '400': errorResponses['400'],
      },
    },
  },

  '/delivery/branch': {
    get: {
      tags: ['Delivery', 'Branches'],
      summary: 'Get the configured delivery branch + coverage areas (public)',
      description:
        'Returns `{ configured, branch }`. `branch` is null (and `configured` false) until an admin sets one up. `branch.deliveryAreas` are the named service polygons the marketplace uses to gate access client-side.',
      responses: {
        '200': success({ $ref: '#/components/schemas/BranchEnvelope' }),
      },
    },
    put: {
      tags: ['Delivery', 'Branches'],
      summary: 'Create or update the delivery branch + coverage (staff only)',
      security: bearerAuth,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['name', 'nameAr', 'address', 'latitude', 'longitude'],
              properties: {
                name: { type: 'string' },
                nameAr: { type: 'string' },
                address: { type: 'string' },
                latitude: { type: 'number', minimum: -90, maximum: 90 },
                longitude: { type: 'number', minimum: -180, maximum: 180 },
                phone: { type: 'string', nullable: true },
                deliveryAreas: {
                  type: 'array',
                  nullable: true,
                  description: 'Named service polygons. Omit to leave untouched; null clears.',
                  items: { $ref: '#/components/schemas/NamedArea' },
                },
                excludedPolygons: {
                  type: 'array',
                  nullable: true,
                  description: 'Carve-out rings (each a closed ring of >= 3 points).',
                  items: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/LatLng' },
                  },
                },
              },
            },
          },
        },
      },
      responses: {
        '200': success({ $ref: '#/components/schemas/BranchEnvelope' }, 'Branch saved.'),
        '400': errorResponses['400'],
        '403': errorResponses['403'],
      },
    },
  },

  '/delivery/minimum-order': {
    get: {
      tags: ['Delivery'],
      summary: 'Get admin-configured minimum order settings (public)',
      description:
        'Returned to the cart / checkout so the frontend can gate the "Proceed" button.',
      responses: {
        '200': success({ $ref: '#/components/schemas/MinimumOrder' }),
      },
    },
    put: {
      tags: ['Delivery'],
      summary: 'Update minimum order settings (staff only)',
      security: bearerAuth,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/MinimumOrder' },
          },
        },
      },
      responses: {
        '200': success({ $ref: '#/components/schemas/MinimumOrder' }),
        '403': errorResponses['403'],
      },
    },
  },

  '/delivery/settings': {
    get: {
      tags: ['Delivery', 'Settings'],
      summary: 'Get delivery pricing settings (public)',
      description:
        'Feeds the cart + checkout: `freeDeliveryEnabled`, `freeDeliveryThreshold`, `maxDeliveryKm`, `roadDistanceMultiplier`, etc.',
      responses: {
        '200': success({ $ref: '#/components/schemas/DeliverySettings' }),
      },
    },
    put: {
      tags: ['Delivery', 'Settings'],
      summary: 'Update delivery pricing settings (staff only)',
      description:
        'Zod-whitelisted fields: `deliveryEnabled`, `maxDeliveryKm`, `distanceRulesEnabled`, `roadDistanceMultiplier`, `baseFee`, `freeDeliveryEnabled`, `freeDeliveryThreshold`, `thresholdForNonSubscribers`. Unknown keys are silently stripped.',
      security: bearerAuth,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/DeliverySettings' },
          },
        },
      },
      responses: {
        '200': success({ $ref: '#/components/schemas/DeliverySettings' }),
        '400': errorResponses['400'],
        '403': errorResponses['403'],
      },
    },
  },

  '/delivery/distance-rules': {
    get: {
      tags: ['Delivery', 'Settings'],
      summary: 'List distance-based fee rules (staff only)',
      security: bearerAuth,
      responses: {
        '200': success({
          type: 'array',
          items: { $ref: '#/components/schemas/DistanceRule' },
        }),
        '403': errorResponses['403'],
      },
    },
    put: {
      tags: ['Delivery', 'Settings'],
      summary: 'Replace the full set of distance rules (staff only)',
      security: bearerAuth,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['rules'],
              properties: {
                rules: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/DistanceRule' },
                },
              },
            },
          },
        },
      },
      responses: {
        '200': success({
          type: 'array',
          items: { $ref: '#/components/schemas/DistanceRule' },
        }),
        '400': errorResponses['400'],
      },
    },
  },
};
