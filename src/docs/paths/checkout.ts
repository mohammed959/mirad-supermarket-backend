import { errorResponses, success } from '../helpers';

export const checkoutPaths = {
  '/checkout/calculate-delivery': {
    post: {
      tags: ['Checkout', 'Delivery'],
      summary: 'Resolve delivery fee + eligibility for the current cart',
      description:
        'The single source of truth for delivery pricing. Runs: max-distance gate → subscription benefit → free-delivery threshold → distance rules. Ignores subscription benefits when the customer is out of range.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/DeliveryQuoteRequest' },
            example: {
              customerLatitude: 24.7136,
              customerLongitude: 46.6753,
              customerSubscriptionStatus: 'NONE',
              selectedFulfillmentType: 'DELIVERY',
              cartSubtotal: 200,
            },
          },
        },
      },
      responses: {
        '200': success({ $ref: '#/components/schemas/DeliveryQuoteResponse' }),
        '400': errorResponses['400'],
      },
    },
  },

  '/checkout/pickup-slots': {
    get: {
      tags: ['Checkout', 'Pickup'],
      summary: 'Available scheduled-pickup slots for a given date',
      description:
        'Returns remaining capacity per slot, respecting `PickupSettings.futurePickupEnabled`, `maxReservationDays`, and `cutoffTime`.',
      parameters: [
        {
          in: 'query',
          name: 'date',
          schema: { type: 'string', format: 'date' },
          description: 'YYYY-MM-DD. Defaults to today.',
        },
      ],
      responses: {
        '200': success({
          type: 'array',
          items: { $ref: '#/components/schemas/AvailablePickupSlot' },
        }),
        '400': errorResponses['400'],
      },
    },
  },
};
