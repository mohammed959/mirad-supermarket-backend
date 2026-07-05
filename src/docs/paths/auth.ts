import { bearerAuth, errorResponses, success } from '../helpers';

export const authPaths = {
  '/auth/request-otp': {
    post: {
      tags: ['Authentication'],
      summary: 'Request a 6-digit OTP for a customer mobile number',
      description:
        'Sends an SMS-style OTP to the given mobile. Also registers the number as a customer if new. `DEV_OTP_OVERRIDE` in `.env` forces a fixed OTP (e.g. `123456`) so QA can log in without a real SMS gateway.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/RequestOtpRequest' },
            example: { mobile: '+966501234567' },
          },
        },
      },
      responses: {
        '200': success(
          {
            type: 'object',
            properties: {
              mobile: { type: 'string' },
              expiresInMinutes: { type: 'integer', example: 5 },
            },
          },
          'OTP sent',
          {
            success: true,
            message: 'OTP sent',
            data: { mobile: '+966501234567', expiresInMinutes: 5 },
          },
        ),
        '400': errorResponses['400'],
        '500': errorResponses['500'],
      },
    },
  },

  '/auth/verify-otp': {
    post: {
      tags: ['Authentication'],
      summary: 'Verify OTP and receive a customer JWT',
      description:
        'Consumes the OTP and returns a 7-day customer-scoped JWT. Attach as `Authorization: Bearer <token>` on every subsequent customer request.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/VerifyOtpRequest' },
            example: { mobile: '+966501234567', code: '123456' },
          },
        },
      },
      responses: {
        '200': success(
          { $ref: '#/components/schemas/AuthTokenResponse' },
          'Login successful',
        ),
        '400': errorResponses['400'],
        '500': errorResponses['500'],
      },
    },
  },

  '/auth/staff/login': {
    post: {
      tags: ['Authentication'],
      summary: 'Staff email/password login (SUPER_ADMIN / PICKER / DRIVER)',
      description:
        'Returns a staff-scoped JWT. Customer tokens can never satisfy staff endpoints; staff tokens can never satisfy customer endpoints.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/StaffLoginRequest' },
            example: { email: 'admin@alhathlul.sa', password: 'StrongP@ss1' },
          },
        },
      },
      responses: {
        '200': success(
          { $ref: '#/components/schemas/AuthTokenResponse' },
          'Login successful',
        ),
        '401': errorResponses['401'],
        '500': errorResponses['500'],
      },
    },
  },

  '/auth/me': {
    get: {
      tags: ['Authentication', 'Profile'],
      summary: 'Get the currently authenticated user',
      description:
        'Accepts either a customer or a staff bearer token. Response shape is the same either way.',
      security: bearerAuth,
      responses: {
        '200': success({ $ref: '#/components/schemas/Customer' }),
        '401': errorResponses['401'],
      },
    },
  },
};
