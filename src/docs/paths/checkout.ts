import { bearerAuth, errorResponses, success } from '../helpers';

export const checkoutPaths = {
  '/checkout/prepare': {
    post: {
      tags: ['Checkout'],
      summary: 'One authoritative checkout-preparation call (customer only)',
      description:
        'Verifies the address, loads current product prices/availability/stock, the customer\'s active subscription, minimum-order config, and the admin\'s subtotal-based delivery pricing — all server-side. Returns a short-lived (15 min), single-use `checkoutSessionId` that `POST /orders` later consumes. ' +
        'Calculation order: product subtotal → subtotal delivery-pricing rule → base delivery fee → free-delivery threshold → subscription delivery benefit → final delivery fee. Pickup always has a zero fee. ' +
        'Never accepts subscription status, subtotal, product prices, delivery fee, coverage result, or raw coordinates from the client — see `blockers` for why checkout can\'t proceed (invalid/uncovered address, unavailable product, insufficient stock, minimum order, unavailable fulfillment).',
      security: bearerAuth,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CheckoutPrepareRequest' },
            example: {
              lang: 'ar',
              addressId: 'clw...',
              selectedFulfillmentType: 'DELIVERY',
              items: [{ productId: 'clw...', quantity: 2 }],
            },
          },
        },
      },
      responses: {
        '200': success({ $ref: '#/components/schemas/CheckoutPrepareResponse' }),
        '400': errorResponses['400'],
        '401': errorResponses['401'],
      },
    },
  },

  '/checkout/calculate-delivery': {
    post: {
      tags: ['Checkout', 'Delivery'],
      summary: '[Legacy] Resolve delivery fee + eligibility for the current cart',
      description:
        'Superseded by `POST /checkout/prepare` for the customer checkout flow — kept for the cart drawer\'s live fee preview. Runs: coverage/eligibility gate → subscription delivery benefit → free-delivery threshold → subtotal-pricing range. Distance no longer decides the FEE (only whether delivery is offered at all); `distanceRulesEnabled` and `DeliveryDistanceRule` are historical and no longer read here.',
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
