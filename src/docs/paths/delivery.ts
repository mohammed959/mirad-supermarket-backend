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
              area: { name: 'Riyadh Al Khabra' },
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
        'Returns `{ configured, branch }`. `branch` is null (and `configured` false) until an admin sets one up. `branch.deliveryAreas` are the named service polygons the marketplace uses to gate access client-side.\n\nWithout `lang`, `branch.name`/`nameAr` and each delivery area\'s `name`/`nameAr` keep today\'s bilingual shape — this is what the admin branch-coverage editor relies on. When `lang` (`ar`|`en`) is passed, `name` is localized instead and `nameAr` is dropped, on the branch and on every delivery area.',
      parameters: [
        {
          in: 'query',
          name: 'lang',
          required: false,
          schema: { type: 'string', enum: ['ar', 'en'] },
          description: 'Opts into the marketplace-localized shape. Omit to get today\'s bilingual shape.',
        },
      ],
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
        'Zod-whitelisted fields: `deliveryEnabled`, `maxDeliveryKm`, `distanceRulesEnabled`, `roadDistanceMultiplier`, `baseFee`, `freeDeliveryEnabled`, `freeDeliveryThreshold`, `thresholdForNonSubscribers`. Unknown keys are silently stripped. ' +
        'Only `deliveryEnabled` and `maxDeliveryKm` are LIVE — they still gate whether delivery is offered at all. `distanceRulesEnabled`, `baseFee`, `freeDeliveryEnabled`, `freeDeliveryThreshold`, and `thresholdForNonSubscribers` are DEAD for pricing purposes: the delivery FEE is decided by `/delivery/subtotal-pricing`, not these fields. Kept writable for historical/back-compat reasons only.',
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
      summary: '[Historical] List distance-based fee rules (staff only)',
      description:
        'No longer used to price delivery — see `/delivery/subtotal-pricing`. Distance is still computed and reported (`distanceKm`) and the branch\'s delivery-area polygons still decide eligibility, but these per-km rules and their fees are not read by `computeDeliveryQuote` anymore. Preserved for historical reference; not deleted.',
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
      summary: '[Historical] Replace the full set of distance rules (staff only)',
      description: 'Still validated and stored, but no longer read to price delivery — see `/delivery/subtotal-pricing`.',
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

  '/delivery/subtotal-pricing': {
    get: {
      tags: ['Delivery', 'Settings'],
      summary: 'Get the current subtotal-based delivery pricing (staff only)',
      description:
        'The delivery FEE source of truth — replaces distance-based pricing. Distance/coverage (branch, delivery areas, `/delivery/distance-rules`) still decides only whether delivery is offered at all; the fee itself comes from these subtotal ranges + the free-delivery threshold.',
      security: bearerAuth,
      responses: {
        '200': success({ $ref: '#/components/schemas/DeliverySubtotalPricing' }),
        '401': errorResponses['401'],
      },
    },
    put: {
      tags: ['Delivery', 'Settings'],
      summary: 'Replace the complete subtotal-pricing configuration atomically (staff only)',
      description:
        'Saves the free-delivery threshold and ALL ranges together — never partially. Ranges must run from 0 with no gaps or overlaps, in order, ending exactly at `freeDeliveryThreshold`. On failure, the previous configuration is left untouched and the response carries a machine-readable `code`: `DELIVERY_PRICING_GAP`, `DELIVERY_PRICING_OVERLAP`, `INVALID_DELIVERY_RANGE`, `INVALID_FREE_DELIVERY_THRESHOLD`, or `INCOMPLETE_DELIVERY_PRICING`.',
      security: bearerAuth,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/DeliverySubtotalPricingInput' },
            example: {
              freeDeliveryThreshold: 150,
              ranges: [
                { minSubtotal: 0, maxSubtotal: 50, deliveryFee: 15 },
                { minSubtotal: 50, maxSubtotal: 100, deliveryFee: 10 },
                { minSubtotal: 100, maxSubtotal: 150, deliveryFee: 5 },
              ],
            },
          },
        },
      },
      responses: {
        '200': success({ $ref: '#/components/schemas/DeliverySubtotalPricing' }, 'Delivery pricing saved.'),
        '400': {
          description: 'Validation failed — see `code`.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
              example: { success: false, message: 'Range 2 leaves a gap after range 1 (50 → 60).', code: 'DELIVERY_PRICING_GAP' },
            },
          },
        },
        '401': errorResponses['401'],
      },
    },
  },
};
