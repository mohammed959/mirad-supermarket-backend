/**
 * OpenAPI 3.0.3 reusable schemas for Alhathlul Supermarket.
 *
 * Every response the backend sends is wrapped by lib/response.ts as:
 *   { success: true,  message: string, data: <payload> }   (2xx)
 *   { success: false, message: string, errors?: unknown }  (4xx / 5xx)
 *
 * The two envelope schemas (`ApiSuccess` / `ErrorResponse`) live here and
 * are referenced by every operation. Payload-specific schemas below
 * (Product, Order, Customer, …) describe the shape that lands inside
 * `data`.
 */
export const schemas = {
  // ── Response envelopes ──────────────────────────────────────────────
  ApiSuccess: {
    type: 'object',
    required: ['success', 'message', 'data'],
    properties: {
      success: { type: 'boolean', example: true },
      message: { type: 'string', example: 'Success' },
      data: {},
    },
  },
  ErrorResponse: {
    type: 'object',
    required: ['success', 'message'],
    properties: {
      success: { type: 'boolean', example: false },
      message: { type: 'string', example: 'Invalid or expired token' },
      errors: {
        description: 'Optional per-field Zod validation errors.',
        nullable: true,
      },
    },
  },
  Pagination: {
    type: 'object',
    properties: {
      page: { type: 'integer', example: 1 },
      limit: { type: 'integer', example: 20 },
      total: { type: 'integer', example: 123 },
      totalPages: { type: 'integer', example: 7 },
    },
  },

  // ── Enums (mirror prisma/schema.prisma) ─────────────────────────────
  Role: {
    type: 'string',
    enum: ['CUSTOMER', 'SUPER_ADMIN', 'PICKER', 'DRIVER'],
  },
  OrderStatus: {
    type: 'string',
    enum: [
      'NEW',
      'PAYMENT_VERIFIED',
      'ASSIGNED_TO_PICKER',
      'PICKING_IN_PROGRESS',
      'READY_FOR_DELIVERY',
      'READY_FOR_PICKUP',
      'ASSIGNED_TO_DRIVER',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
      'PICKED_UP_BY_CUSTOMER',
      'COMPLETED',
      'CONFIRMED',
      'CANCELLED',
      'REJECTED',
    ],
  },
  OrderItemStatus: {
    type: 'string',
    enum: ['PENDING', 'PICKED', 'UNAVAILABLE', 'REPLACED', 'REMOVED'],
  },
  FulfillmentType: { type: 'string', enum: ['DELIVERY', 'PICKUP'] },
  PickupType: { type: 'string', enum: ['ASAP', 'SCHEDULED'] },
  PaymentMethod: {
    type: 'string',
    enum: ['CASH_ON_DELIVERY', 'BANK_TRANSFER', 'PAY_AT_BRANCH'],
  },
  PaymentStatus: {
    type: 'string',
    enum: ['PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'],
  },
  SubscriptionBenefitType: {
    type: 'string',
    enum: ['FREE_DELIVERY', 'DISCOUNTED_DELIVERY', 'CAPPED_DELIVERY'],
  },
  SubscriptionStatus: {
    type: 'string',
    enum: ['PENDING_PAYMENT', 'ACTIVE', 'EXPIRED', 'CANCELLED'],
  },
  NotificationType: {
    type: 'string',
    enum: [
      'ORDER_STATUS_CHANGED',
      'ORDER_ASSIGNED',
      'SUBSCRIPTION_ACTIVATED',
      'SUBSCRIPTION_EXPIRING',
      'PROMOTION_ACTIVATED',
    ],
  },
  PromotionType: {
    type: 'string',
    enum: [
      'BUY_X_GET_Y',
      'VARIANT_DISCOUNT',
      'PRODUCT_DISCOUNT',
      'CATEGORY_DISCOUNT',
      'FREE_DELIVERY_THRESHOLD',
      'SUBSCRIPTION_BASED_DISCOUNT',
    ],
  },
  TargetScope: {
    type: 'string',
    enum: ['ALL', 'PRODUCT', 'VARIANT', 'CATEGORY', 'SUBCATEGORY'],
  },

  // ── Auth ────────────────────────────────────────────────────────────
  RequestOtpRequest: {
    type: 'object',
    required: ['mobile'],
    properties: {
      mobile: {
        type: 'string',
        minLength: 9,
        maxLength: 15,
        example: '+966501234567',
      },
    },
  },
  VerifyOtpRequest: {
    type: 'object',
    required: ['mobile', 'code'],
    properties: {
      mobile: { type: 'string', example: '+966501234567' },
      code: { type: 'string', minLength: 6, maxLength: 6, example: '123456' },
    },
  },
  StaffLoginRequest: {
    type: 'object',
    required: ['email', 'password'],
    properties: {
      email: { type: 'string', format: 'email', example: 'admin@alhathlul.sa' },
      password: { type: 'string', example: 'StrongP@ss1' },
    },
  },
  AuthTokenResponse: {
    type: 'object',
    properties: {
      token: {
        type: 'string',
        description: 'JWT (HS256, 7-day). Attach as `Authorization: Bearer <token>`.',
        example:
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ...',
      },
      user: { $ref: '#/components/schemas/Customer' },
    },
  },

  // ── User / Customer ─────────────────────────────────────────────────
  Customer: {
    type: 'object',
    properties: {
      id: { type: 'string', example: 'clw7...' },
      mobile: { type: 'string', nullable: true, example: '+966501234567' },
      email: { type: 'string', nullable: true, example: 'user@example.com' },
      username: { type: 'string', nullable: true, example: 'admin.picker' },
      name: { type: 'string', nullable: true, example: 'Mohammed AlSoder' },
      nameAr: { type: 'string', nullable: true, example: 'محمد السدر' },
      role: { $ref: '#/components/schemas/Role' },
      isActive: { type: 'boolean', example: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  UpdateProfileRequest: {
    type: 'object',
    properties: {
      name: { type: 'string', example: 'Mohammed AlSoder' },
      nameAr: { type: 'string', example: 'محمد السدر' },
      email: { type: 'string', format: 'email', nullable: true },
    },
  },
  CreateStaffRequest: {
    type: 'object',
    required: ['username', 'password', 'role'],
    properties: {
      username: { type: 'string', example: 'picker.jane' },
      password: { type: 'string', minLength: 6, example: 'StrongP@ss1' },
      name: { type: 'string', example: 'Jane Picker' },
      nameAr: { type: 'string', example: 'جين' },
      role: {
        type: 'string',
        enum: ['SUPER_ADMIN', 'PICKER', 'DRIVER'],
        example: 'PICKER',
      },
      mobile: { type: 'string', nullable: true },
    },
  },
  SetRoleRequest: {
    type: 'object',
    required: ['role'],
    properties: {
      role: { $ref: '#/components/schemas/Role' },
    },
  },
  ToggleStatusRequest: {
    type: 'object',
    required: ['isActive'],
    properties: {
      isActive: { type: 'boolean', example: false },
    },
  },
  ResetPasswordRequest: {
    type: 'object',
    required: ['password'],
    properties: {
      password: { type: 'string', minLength: 6, example: 'NewStr0ngP@ss' },
    },
  },

  // ── Address ─────────────────────────────────────────────────────────
  Address: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      label: { type: 'string', example: 'Home' },
      addressLine: {
        type: 'string',
        nullable: true,
        example: 'King Fahd Rd, Riyadh 12271',
      },
      city: { type: 'string', nullable: true, example: 'Riyadh' },
      deliveryNotes: {
        type: 'string',
        nullable: true,
        example: 'Ring the bell twice',
      },
      latitude: { type: 'number', example: 24.7136 },
      longitude: { type: 'number', example: 46.6753 },
      isDefault: { type: 'boolean', example: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  CreateAddressRequest: {
    type: 'object',
    required: ['latitude', 'longitude'],
    properties: {
      label: { type: 'string', example: 'Home' },
      addressLine: { type: 'string', example: 'King Fahd Rd, Riyadh' },
      city: { type: 'string', example: 'Riyadh' },
      deliveryNotes: { type: 'string', nullable: true },
      latitude: { type: 'number', example: 24.7136 },
      longitude: { type: 'number', example: 46.6753 },
      isDefault: { type: 'boolean', example: false },
    },
  },
  UpdateAddressRequest: {
    allOf: [{ $ref: '#/components/schemas/CreateAddressRequest' }],
    description: 'All fields optional.',
  },

  // ── Category / Subcategory ──────────────────────────────────────────
  Category: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string', example: 'Dairy & Eggs' },
      nameAr: { type: 'string', example: 'الألبان والبيض' },
      slug: { type: 'string', example: 'dairy-eggs' },
      imageUrl: { type: 'string', nullable: true },
      sortOrder: { type: 'integer', example: 1 },
      isActive: { type: 'boolean', example: true },
      subcategories: {
        type: 'array',
        items: { $ref: '#/components/schemas/Subcategory' },
      },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  Subcategory: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      categoryId: { type: 'string' },
      name: { type: 'string', example: 'Milk' },
      nameAr: { type: 'string', example: 'حليب' },
      slug: { type: 'string', example: 'milk' },
      imageUrl: { type: 'string', nullable: true },
      sortOrder: { type: 'integer', example: 1 },
      isActive: { type: 'boolean', example: true },
    },
  },
  UpsertCategoryRequest: {
    type: 'object',
    required: ['name', 'nameAr', 'slug'],
    properties: {
      name: { type: 'string', example: 'Dairy & Eggs' },
      nameAr: { type: 'string', example: 'الألبان والبيض' },
      slug: { type: 'string', example: 'dairy-eggs' },
      imageUrl: { type: 'string', nullable: true },
      sortOrder: { type: 'integer', example: 1 },
      isActive: { type: 'boolean', example: true },
    },
  },
  UpsertSubcategoryRequest: {
    type: 'object',
    required: ['name', 'nameAr', 'slug'],
    properties: {
      name: { type: 'string' },
      nameAr: { type: 'string' },
      slug: { type: 'string' },
      imageUrl: { type: 'string', nullable: true },
      sortOrder: { type: 'integer' },
      isActive: { type: 'boolean' },
    },
  },

  // ── Product / Brand ─────────────────────────────────────────────────
  Product: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      categoryId: { type: 'string' },
      subcategoryId: { type: 'string', nullable: true },
      brandId: { type: 'string', nullable: true },
      name: { type: 'string', example: 'Almarai Full Cream Milk 1L' },
      nameAr: { type: 'string', example: 'حليب المراعي كامل الدسم ١ لتر' },
      description: { type: 'string', nullable: true },
      descriptionAr: { type: 'string', nullable: true },
      sku: { type: 'string', nullable: true, example: 'ALM-MLK-1L' },
      barcode: { type: 'string', nullable: true, example: '6281007054124' },
      price: { type: 'number', example: 6.5 },
      stock: { type: 'integer', example: 120 },
      reserved: { type: 'integer', example: 4 },
      isActive: { type: 'boolean', example: true },
      isFeatured: { type: 'boolean', example: false },
      hideFromHome: { type: 'boolean', example: false },
      imageUrl: {
        type: 'string',
        nullable: true,
        description:
          'CDN URL derived from SKU when unset. Falls back to the default product image if missing on CDN.',
      },
      category: { $ref: '#/components/schemas/Category' },
      subcategory: {
        oneOf: [{ $ref: '#/components/schemas/Subcategory' }, { type: 'null' }],
      },
      brand: {
        oneOf: [{ $ref: '#/components/schemas/Brand' }, { type: 'null' }],
      },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  CreateProductRequest: {
    type: 'object',
    required: ['categoryId', 'brandId', 'name', 'nameAr', 'sku', 'price', 'quantity'],
    properties: {
      categoryId: { type: 'string' },
      subcategoryId: { type: 'string', nullable: true },
      brandId: { type: 'string' },
      name: { type: 'string', example: 'Almarai Full Cream Milk 1L' },
      nameAr: { type: 'string', example: 'حليب المراعي كامل الدسم ١ لتر' },
      description: { type: 'string' },
      descriptionAr: { type: 'string' },
      sku: { type: 'string', example: 'ALM-MLK-1L' },
      barcode: { type: 'string', example: '6281007054124' },
      price: { type: 'number', example: 6.5 },
      quantity: { type: 'integer', minimum: 0, example: 200 },
      isFeatured: { type: 'boolean' },
      hideFromHome: { type: 'boolean' },
    },
  },
  UpdateProductRequest: {
    allOf: [{ $ref: '#/components/schemas/CreateProductRequest' }],
    description: 'All fields optional.',
  },
  AdjustStockRequest: {
    type: 'object',
    description: 'Provide exactly one of `delta` or `set`.',
    properties: {
      delta: {
        type: 'integer',
        description: 'Signed adjustment (positive = add, negative = subtract).',
        example: -5,
      },
      set: {
        type: 'integer',
        minimum: 0,
        description: 'Overwrite stock to this absolute value.',
        example: 100,
      },
    },
  },
  Brand: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string', example: 'Almarai' },
      nameAr: { type: 'string', example: 'المراعي' },
      slug: { type: 'string', example: 'almarai' },
      imageUrl: { type: 'string', nullable: true },
      isActive: { type: 'boolean' },
      sortOrder: { type: 'integer' },
    },
  },
  UpsertBrandRequest: {
    type: 'object',
    required: ['name', 'nameAr', 'slug'],
    properties: {
      name: { type: 'string' },
      nameAr: { type: 'string' },
      slug: {
        type: 'string',
        pattern: '^[a-z0-9-]+$',
        example: 'almarai',
      },
      isActive: { type: 'boolean' },
      sortOrder: { type: 'integer' },
    },
  },

  // ── Order ───────────────────────────────────────────────────────────
  OrderItem: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      productId: { type: 'string', nullable: true },
      productSku: { type: 'string', nullable: true },
      productBarcode: { type: 'string', nullable: true },
      productName: { type: 'string', nullable: true },
      productNameAr: { type: 'string', nullable: true },
      quantity: { type: 'integer', example: 2 },
      unitPrice: { type: 'number', example: 6.5 },
      discountedPrice: { type: 'number', nullable: true },
      total: { type: 'number', example: 13.0 },
      isFreeItem: { type: 'boolean', example: false },
      status: { $ref: '#/components/schemas/OrderItemStatus' },
      replacedByItemId: { type: 'string', nullable: true },
      notes: { type: 'string', nullable: true },
      product: {
        oneOf: [{ $ref: '#/components/schemas/Product' }, { type: 'null' }],
      },
    },
  },
  Order: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      orderNumber: { type: 'string', example: 'AH-100234' },
      customerId: { type: 'string' },
      addressId: { type: 'string', nullable: true },
      pickerId: { type: 'string', nullable: true },
      driverId: { type: 'string', nullable: true },
      status: { $ref: '#/components/schemas/OrderStatus' },
      fulfillmentType: { $ref: '#/components/schemas/FulfillmentType' },
      paymentMethod: { $ref: '#/components/schemas/PaymentMethod' },
      paymentStatus: { $ref: '#/components/schemas/PaymentStatus' },
      subtotal: { type: 'number', example: 200.0 },
      discountTotal: { type: 'number', example: 0.0 },
      deliveryFee: { type: 'number', example: 15.0 },
      total: { type: 'number', example: 215.0 },
      notes: { type: 'string', nullable: true },
      replacementPreference: { type: 'string', nullable: true },
      paymentProofUrl: { type: 'string', nullable: true },
      deliveryLat: { type: 'number', nullable: true },
      deliveryLng: { type: 'number', nullable: true },
      distanceKm: { type: 'number', nullable: true, example: 4.72 },
      subscriptionApplied: { type: 'boolean' },
      rejectionReason: { type: 'string', nullable: true },
      pickupType: {
        oneOf: [{ $ref: '#/components/schemas/PickupType' }, { type: 'null' }],
      },
      scheduledPickupDate: {
        type: 'string',
        format: 'date',
        nullable: true,
        example: '2026-07-05',
      },
      scheduledPickupStartTime: { type: 'string', nullable: true, example: '18:00' },
      scheduledPickupEndTime: { type: 'string', nullable: true, example: '20:00' },
      carPlateNumber: { type: 'string', nullable: true },
      carBrand: { type: 'string', nullable: true },
      carColor: { type: 'string', nullable: true },
      pickupCustomerNote: { type: 'string', nullable: true },
      items: {
        type: 'array',
        items: { $ref: '#/components/schemas/OrderItem' },
      },
      address: {
        oneOf: [{ $ref: '#/components/schemas/Address' }, { type: 'null' }],
      },
      customer: {
        oneOf: [{ $ref: '#/components/schemas/Customer' }, { type: 'null' }],
      },
      deliveredAt: { type: 'string', format: 'date-time', nullable: true },
      pickedUpAt: { type: 'string', format: 'date-time', nullable: true },
      completedAt: { type: 'string', format: 'date-time', nullable: true },
      confirmedAt: { type: 'string', format: 'date-time', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  CreateOrderRequest: {
    type: 'object',
    required: ['paymentMethod', 'items'],
    properties: {
      fulfillmentType: {
        $ref: '#/components/schemas/FulfillmentType',
      },
      addressId: {
        type: 'string',
        description: 'Required when fulfillmentType = DELIVERY.',
      },
      paymentMethod: { $ref: '#/components/schemas/PaymentMethod' },
      notes: { type: 'string' },
      replacementPreference: { type: 'string' },
      deliveryLat: { type: 'number', minimum: -90, maximum: 90 },
      deliveryLng: { type: 'number', minimum: -180, maximum: 180 },
      pickupType: { $ref: '#/components/schemas/PickupType' },
      scheduledPickupDate: {
        type: 'string',
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        example: '2026-07-05',
      },
      scheduledPickupSlotId: { type: 'string' },
      items: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          required: ['productId', 'quantity'],
          properties: {
            productId: { type: 'string' },
            quantity: { type: 'integer', minimum: 1, example: 2 },
          },
        },
      },
    },
  },
  UpdateStatusRequest: {
    type: 'object',
    required: ['status'],
    properties: {
      status: { $ref: '#/components/schemas/OrderStatus' },
      note: { type: 'string' },
    },
  },
  AssignPickerRequest: {
    type: 'object',
    required: ['pickerId'],
    properties: { pickerId: { type: 'string' } },
  },
  AssignDriverRequest: {
    type: 'object',
    required: ['driverId'],
    properties: { driverId: { type: 'string' } },
  },
  RejectOrderRequest: {
    type: 'object',
    required: ['reason'],
    properties: { reason: { type: 'string', example: 'Out of stock' } },
  },
  CarPickupDetailsRequest: {
    type: 'object',
    properties: {
      carPlateNumber: { type: 'string', example: 'ABC 1234' },
      carBrand: { type: 'string', example: 'Toyota' },
      carColor: { type: 'string', example: 'White' },
      pickupCustomerNote: {
        type: 'string',
        example: 'Please call on arrival',
      },
    },
  },
  SetItemStatusRequest: {
    type: 'object',
    required: ['status'],
    properties: {
      status: { $ref: '#/components/schemas/OrderItemStatus' },
      notes: { type: 'string' },
    },
  },
  ReplaceItemRequest: {
    type: 'object',
    required: ['productId', 'quantity'],
    properties: {
      productId: { type: 'string' },
      quantity: { type: 'integer', minimum: 1 },
      notes: { type: 'string' },
    },
  },

  // ── Delivery ────────────────────────────────────────────────────────
  LatLng: {
    type: 'object',
    description: 'A single geographic coordinate.',
    required: ['lat', 'lng'],
    properties: {
      lat: { type: 'number', example: 25.795 },
      lng: { type: 'number', example: 44.068 },
    },
  },
  NamedArea: {
    type: 'object',
    description:
      'A named delivery/service polygon. A customer location is serviceable when it falls inside ANY area and outside every excluded ring.',
    required: ['name', 'nameAr', 'polygon'],
    properties: {
      name: { type: 'string', example: 'Riyadh Al Khabra' },
      nameAr: { type: 'string', example: 'رياض الخبراء' },
      polygon: {
        type: 'array',
        description: 'Closed ring of >= 3 vertices.',
        items: { $ref: '#/components/schemas/LatLng' },
      },
    },
  },
  Branch: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string', example: 'Mirad Central' },
      nameAr: { type: 'string', example: 'ميراد المركزي' },
      address: { type: 'string' },
      latitude: { type: 'number', example: 25.795 },
      longitude: { type: 'number', example: 44.068 },
      phone: { type: 'string', nullable: true },
      deliveryAreas: {
        type: 'array',
        description: 'Named service polygons covering the supported cities.',
        items: { $ref: '#/components/schemas/NamedArea' },
      },
      excludedPolygons: {
        type: 'array',
        description: 'Carve-out rings subtracted from the service areas.',
        items: {
          type: 'array',
          items: { $ref: '#/components/schemas/LatLng' },
        },
      },
    },
  },
  BranchEnvelope: {
    type: 'object',
    description: 'Wrapper returned by GET /delivery/branch.',
    properties: {
      configured: {
        type: 'boolean',
        description: 'False when no active branch has been set up yet.',
        example: true,
      },
      branch: {
        oneOf: [{ $ref: '#/components/schemas/Branch' }, { type: 'null' }],
      },
    },
  },
  CoverageResult: {
    type: 'object',
    description: 'Result of the public marketplace-access coverage check.',
    properties: {
      configured: {
        type: 'boolean',
        description: 'False when no coverage areas exist yet (callers should fail open).',
        example: true,
      },
      covered: {
        type: 'boolean',
        description: 'True when the point falls inside a supported city.',
        example: true,
      },
      area: {
        nullable: true,
        description: 'The matched city, or null when out of coverage.',
        type: 'object',
        properties: {
          name: { type: 'string', example: 'Riyadh Al Khabra' },
          nameAr: { type: 'string', example: 'رياض الخبراء' },
        },
      },
    },
  },
  DeliverySettings: {
    type: 'object',
    properties: {
      deliveryEnabled: { type: 'boolean' },
      maxDeliveryKm: { type: 'number', nullable: true, example: 15 },
      distanceRulesEnabled: { type: 'boolean' },
      roadDistanceMultiplier: { type: 'number', example: 1.35 },
      baseFee: { type: 'number', example: 10.0 },
      freeDeliveryEnabled: { type: 'boolean' },
      freeDeliveryThreshold: { type: 'number', nullable: true, example: 200 },
      thresholdForNonSubscribers: { type: 'boolean' },
    },
  },
  MinimumOrder: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean', example: true },
      minimumAmount: { type: 'number', example: 50 },
    },
  },
  DistanceRule: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      minKm: { type: 'number', example: 0 },
      maxKm: { type: 'number', nullable: true, example: 5 },
      fee: { type: 'number', example: 10 },
      outOfService: { type: 'boolean' },
      discountPercent: { type: 'number', nullable: true },
      discountStartDate: { type: 'string', format: 'date-time', nullable: true },
      discountEndDate: { type: 'string', format: 'date-time', nullable: true },
      basketThreshold: { type: 'number', nullable: true },
      feeAboveThreshold: { type: 'number', nullable: true },
      sortOrder: { type: 'integer' },
    },
  },
  DeliveryQuoteRequest: {
    type: 'object',
    required: ['cartSubtotal'],
    properties: {
      customerLat: { type: 'number', nullable: true, example: 25.795 },
      customerLng: { type: 'number', nullable: true, example: 44.068 },
      cartSubtotal: { type: 'number', example: 200 },
      fulfillmentType: { $ref: '#/components/schemas/FulfillmentType' },
    },
  },
  DeliveryQuoteResponse: {
    type: 'object',
    properties: {
      deliveryFee: { type: 'number', example: 15.0 },
      pricingRuleApplied: {
        type: 'string',
        enum: [
          'NO_BRANCH',
          'PICKUP_ONLY',
          'NO_RULES',
          'NO_LOCATION',
          'OUT_OF_RANGE',
          'SUBSCRIPTION',
          'THRESHOLD',
          'RULE',
          'PICKUP',
          'FLAT',
        ],
      },
      reason: { type: 'string' },
      deliveryAvailable: { type: 'boolean', example: true },
      distanceKm: { type: 'number', nullable: true, example: 4.72 },
      message: { type: 'string', nullable: true },
      availableFulfillmentTypes: {
        type: 'array',
        items: { $ref: '#/components/schemas/FulfillmentType' },
      },
    },
  },

  // ── Subscription ────────────────────────────────────────────────────
  SubscriptionPlan: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string', example: 'Free Delivery Monthly' },
      nameAr: { type: 'string', example: 'توصيل مجاني شهري' },
      price: { type: 'number', example: 49.0 },
      durationDays: { type: 'integer', example: 30 },
      benefitType: { $ref: '#/components/schemas/SubscriptionBenefitType' },
      discountValue: { type: 'number', nullable: true, example: 5.0 },
      cappedFee: { type: 'number', nullable: true, example: 5.0 },
      maxFreeDeliveries: { type: 'integer', nullable: true },
      isActive: { type: 'boolean' },
      activeSubscriberCount: { type: 'integer', example: 42 },
    },
  },
  CustomerSubscription: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      customerId: { type: 'string' },
      planId: { type: 'string' },
      startDate: { type: 'string', format: 'date-time' },
      expiryDate: { type: 'string', format: 'date-time' },
      status: { $ref: '#/components/schemas/SubscriptionStatus' },
      deliveriesUsed: { type: 'integer' },
      paymentMethod: { type: 'string' },
      plan: { $ref: '#/components/schemas/SubscriptionPlan' },
    },
  },
  SubscribeRequest: {
    type: 'object',
    required: ['planId', 'paymentMethod'],
    properties: {
      planId: { type: 'string' },
      paymentMethod: { $ref: '#/components/schemas/PaymentMethod' },
      customerLat: { type: 'number' },
      customerLng: { type: 'number' },
    },
  },
  CreatePlanRequest: {
    type: 'object',
    required: ['name', 'nameAr', 'price', 'durationDays', 'benefitType'],
    properties: {
      name: { type: 'string' },
      nameAr: { type: 'string' },
      price: { type: 'number' },
      durationDays: { type: 'integer' },
      benefitType: { $ref: '#/components/schemas/SubscriptionBenefitType' },
      discountValue: { type: 'number' },
      cappedFee: { type: 'number' },
      maxFreeDeliveries: { type: 'integer' },
      isActive: { type: 'boolean' },
    },
  },

  // ── Notification ────────────────────────────────────────────────────
  Notification: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      userId: { type: 'string' },
      orderId: { type: 'string', nullable: true },
      type: { $ref: '#/components/schemas/NotificationType' },
      title: { type: 'string' },
      body: { type: 'string' },
      isRead: { type: 'boolean' },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  BroadcastNotificationRequest: {
    type: 'object',
    required: ['title', 'body', 'target'],
    properties: {
      title: { type: 'string', example: 'Weekend Sale!' },
      body: { type: 'string', example: 'Up to 30% off all snacks.' },
      type: { $ref: '#/components/schemas/NotificationType' },
      target: { type: 'string', enum: ['ALL_CUSTOMERS', 'USER'] },
      userId: {
        type: 'string',
        description: "Required when target = 'USER'.",
      },
    },
  },

  // ── Banner / Featured Section / Promotion ──────────────────────────
  Banner: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      titleAr: { type: 'string' },
      imageUrl: { type: 'string', format: 'uri' },
      linkType: {
        type: 'string',
        nullable: true,
        example: 'category',
      },
      linkValue: {
        type: 'string',
        nullable: true,
        example: 'clw...category-id',
      },
      sortOrder: { type: 'integer' },
      isActive: { type: 'boolean' },
    },
  },
  UpsertBannerRequest: {
    type: 'object',
    required: ['title', 'titleAr', 'imageUrl'],
    properties: {
      title: { type: 'string' },
      titleAr: { type: 'string' },
      imageUrl: { type: 'string', format: 'uri' },
      linkType: { type: 'string' },
      linkValue: { type: 'string' },
      sortOrder: { type: 'integer' },
      isActive: { type: 'boolean' },
    },
  },
  FeaturedSection: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      nameAr: { type: 'string' },
      sortOrder: { type: 'integer' },
      isActive: { type: 'boolean' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            productId: { type: 'string' },
            sortOrder: { type: 'integer' },
            product: { $ref: '#/components/schemas/Product' },
          },
        },
      },
    },
  },
  UpsertFeaturedSectionRequest: {
    type: 'object',
    required: ['name', 'nameAr'],
    properties: {
      name: { type: 'string' },
      nameAr: { type: 'string' },
      sortOrder: { type: 'integer' },
      isActive: { type: 'boolean' },
    },
  },
  AddProductsToSectionRequest: {
    type: 'object',
    required: ['productIds'],
    properties: {
      productIds: { type: 'array', items: { type: 'string' } },
    },
  },
  Promotion: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      nameAr: { type: 'string' },
      description: { type: 'string', nullable: true },
      descriptionAr: { type: 'string', nullable: true },
      type: { $ref: '#/components/schemas/PromotionType' },
      isActive: { type: 'boolean' },
      isStackable: { type: 'boolean' },
      priority: { type: 'integer' },
      startDate: { type: 'string', format: 'date-time' },
      endDate: { type: 'string', format: 'date-time', nullable: true },
      minimumCartValue: { type: 'number', nullable: true },
      usageLimit: { type: 'integer', nullable: true },
      usageLimitPerCustomer: { type: 'integer', nullable: true },
      usageCount: { type: 'integer' },
      requiresSubscription: { type: 'boolean' },
      targetScope: { $ref: '#/components/schemas/TargetScope' },
      config: {
        type: 'object',
        additionalProperties: true,
        description:
          'Promotion-type-specific parameters (e.g. { buyQuantity, getQuantity } for BUY_X_GET_Y, { discountPercent } for VARIANT_DISCOUNT).',
      },
    },
  },
  UpsertPromotionRequest: {
    type: 'object',
    required: ['name', 'nameAr', 'type', 'startDate', 'config'],
    properties: {
      name: { type: 'string' },
      nameAr: { type: 'string' },
      description: { type: 'string' },
      descriptionAr: { type: 'string' },
      type: { $ref: '#/components/schemas/PromotionType' },
      isActive: { type: 'boolean' },
      isStackable: { type: 'boolean' },
      priority: { type: 'integer' },
      startDate: { type: 'string', format: 'date-time' },
      endDate: { type: 'string', format: 'date-time' },
      minimumCartValue: { type: 'number' },
      usageLimit: { type: 'integer' },
      usageLimitPerCustomer: { type: 'integer' },
      requiresSubscription: { type: 'boolean' },
      targetScope: { $ref: '#/components/schemas/TargetScope' },
      targetIds: {
        type: 'array',
        items: { type: 'string' },
        description:
          'IDs of the entities matching `targetScope` (product/variant/category/subcategory IDs).',
      },
      config: { type: 'object', additionalProperties: true },
    },
  },

  // ── Pickup ─────────────────────────────────────────────────────────
  PickupSettings: {
    type: 'object',
    properties: {
      futurePickupEnabled: { type: 'boolean' },
      maxReservationDays: {
        type: 'integer',
        description: '0 = same day only. 1 = today + tomorrow.',
      },
      cutoffTime: { type: 'string', nullable: true, example: '18:00' },
    },
  },
  PickupSlot: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      label: { type: 'string', example: 'Evening (6–8 PM)' },
      startTime: { type: 'string', example: '18:00' },
      endTime: { type: 'string', example: '20:00' },
      capacity: { type: 'integer', example: 20 },
      isActive: { type: 'boolean' },
      sortOrder: { type: 'integer' },
    },
  },
  UpsertPickupSlotRequest: {
    type: 'object',
    required: ['label', 'startTime', 'endTime', 'capacity'],
    properties: {
      label: { type: 'string' },
      startTime: { type: 'string', example: '18:00' },
      endTime: { type: 'string', example: '20:00' },
      capacity: { type: 'integer', minimum: 1 },
      isActive: { type: 'boolean' },
      sortOrder: { type: 'integer' },
    },
  },
  AvailablePickupSlot: {
    type: 'object',
    properties: {
      slotId: { type: 'string' },
      label: { type: 'string' },
      date: { type: 'string', format: 'date' },
      startTime: { type: 'string', example: '18:00' },
      endTime: { type: 'string', example: '20:00' },
      remainingCapacity: { type: 'integer', example: 15 },
    },
  },

  // ── Audit ──────────────────────────────────────────────────────────
  AuditLog: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      actorId: { type: 'string', nullable: true },
      actorRole: { type: 'string', nullable: true },
      action: { type: 'string', example: 'SUBSCRIPTION_CANCELLED_BY_ADMIN' },
      entityType: { type: 'string', example: 'CustomerSubscription' },
      entityId: { type: 'string', nullable: true },
      changes: { type: 'object', additionalProperties: true, nullable: true },
      ipAddress: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
};
