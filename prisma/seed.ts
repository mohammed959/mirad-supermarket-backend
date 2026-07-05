import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Branch — located among the supported Al-Qassim cities. `deliveryAreas`
  // seeds one named coverage polygon per supported city so the marketplace
  // access gate works out of the box; the admin refines these in
  // /admin/branch-coverage. Squares are ~±0.03° (~3 km) around each centre.
  const deliveryAreas = [
    {
      name: 'Riyadh Al Khabra',
      nameAr: 'رياض الخبراء',
      polygon: [
        { lat: 25.825, lng: 44.038 },
        { lat: 25.825, lng: 44.098 },
        { lat: 25.765, lng: 44.098 },
        { lat: 25.765, lng: 44.038 },
      ],
    },
    {
      name: 'Bukayriyah',
      nameAr: 'البكيرية',
      polygon: [
        { lat: 26.169, lng: 43.628 },
        { lat: 26.169, lng: 43.688 },
        { lat: 26.109, lng: 43.688 },
        { lat: 26.109, lng: 43.628 },
      ],
    },
    {
      name: 'Al Khabra',
      nameAr: 'الخبراء',
      polygon: [
        { lat: 25.733, lng: 43.714 },
        { lat: 25.733, lng: 43.774 },
        { lat: 25.673, lng: 43.774 },
        { lat: 25.673, lng: 43.714 },
      ],
    },
  ];

  const branch = await prisma.branch.upsert({
    where: { id: 'branch-main' },
    update: { deliveryAreas },
    create: {
      id: 'branch-main',
      name: 'Al-Hathlul Main Branch',
      nameAr: 'فرع الهذلول الرئيسي',
      address: 'Riyadh Al Khabra, Al-Qassim, Saudi Arabia',
      latitude: 25.795,
      longitude: 44.068,
      phone: '+966500000000',
      isActive: true,
      deliveryAreas,
    },
  });

  // Super admin — email + password login
  const adminPasswordHash = await bcrypt.hash('Admin@123456', 10);
  await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: { passwordHash: adminPasswordHash, role: 'SUPER_ADMIN', isActive: true },
    create: {
      email: 'admin@example.com',
      username: 'admin',
      passwordHash: adminPasswordHash,
      name: 'Super Admin',
      nameAr: 'المشرف العام',
      role: 'SUPER_ADMIN',
    },
  });

  // Picker — email + password login
  const pickerPasswordHash = await bcrypt.hash('Picker@123456', 10);
  await prisma.user.upsert({
    where: { email: 'picker@example.com' },
    update: { passwordHash: pickerPasswordHash, role: 'PICKER', isActive: true },
    create: {
      email: 'picker@example.com',
      username: 'picker',
      passwordHash: pickerPasswordHash,
      name: 'Ahmed Picker',
      nameAr: 'أحمد الجامع',
      role: 'PICKER',
    },
  });

  // Driver — email + password login
  const driverPasswordHash = await bcrypt.hash('Driver@123456', 10);
  await prisma.user.upsert({
    where: { email: 'driver@example.com' },
    update: { passwordHash: driverPasswordHash, role: 'DRIVER', isActive: true },
    create: {
      email: 'driver@example.com',
      username: 'driver',
      passwordHash: driverPasswordHash,
      name: 'Mohammed Driver',
      nameAr: 'محمد السائق',
      role: 'DRIVER',
    },
  });

  // Categories
  const dairy = await prisma.category.upsert({
    where: { slug: 'dairy' },
    update: {},
    create: {
      name: 'Dairy & Eggs',
      nameAr: 'ألبان وبيض',
      slug: 'dairy',
      sortOrder: 1,
    },
  });

  const beverages = await prisma.category.upsert({
    where: { slug: 'beverages' },
    update: {},
    create: {
      name: 'Beverages',
      nameAr: 'مشروبات',
      slug: 'beverages',
      sortOrder: 2,
    },
  });

  const snacks = await prisma.category.upsert({
    where: { slug: 'snacks' },
    update: {},
    create: {
      name: 'Snacks',
      nameAr: 'وجبات خفيفة',
      slug: 'snacks',
      sortOrder: 3,
    },
  });

  // Subcategories
  const milk = await prisma.subcategory.upsert({
    where: { slug: 'milk' },
    update: {},
    create: {
      categoryId: dairy.id,
      name: 'Milk',
      nameAr: 'حليب',
      slug: 'milk',
      sortOrder: 1,
    },
  });

  const yogurt = await prisma.subcategory.upsert({
    where: { slug: 'yogurt' },
    update: {},
    create: {
      categoryId: dairy.id,
      name: 'Yogurt',
      nameAr: 'زبادي',
      slug: 'yogurt',
      sortOrder: 2,
    },
  });

  // Products
  const almarai = await prisma.product.upsert({
    where: { id: 'prod-almarai-milk' },
    update: {},
    create: {
      id: 'prod-almarai-milk',
      categoryId: dairy.id,
      subcategoryId: milk.id,
      name: 'Almarai Full Fat Milk',
      nameAr: 'حليب المراعي كامل الدسم',
      description: 'Fresh full fat milk from Almarai',
      descriptionAr: 'حليب طازج كامل الدسم من المراعي',
      isFeatured: true,
    },
  });

  // Upsert variant by SKU
  await prisma.productVariant.upsert({
    where: { sku: 'ALM-MILK-1L-PIECE' },
    update: {},
    create: {
      productId: almarai.id,
      type: 'PIECE',
      sku: 'ALM-MILK-1L-PIECE',
      barcode: '6281002310013',
      price: 6.5,
      stock: 200,
    },
  });

  await prisma.productVariant.upsert({
    where: { sku: 'ALM-MILK-1L-CARTON' },
    update: {},
    create: {
      productId: almarai.id,
      type: 'CARTON',
      sku: 'ALM-MILK-1L-CARTON',
      price: 72,
      stock: 50,
    },
  });

  // Delivery settings
  const existingDelivery = await prisma.deliveryPricingSettings.findFirst();
  if (!existingDelivery) {
    await prisma.deliveryPricingSettings.create({
      data: {
        distancePricingEnabled: false,
        baseFee: 10,
        feePerKm: 2,
        minimumFee: 10,
        maximumFee: 50,
        freeDeliveryEnabled: true,
        freeDeliveryThreshold: 100,
        thresholdForSubscribers: true,
        thresholdForNonSubscribers: true,
      },
    });
  }

  // Minimum order settings
  const existingMinOrder = await prisma.minimumOrderSettings.findFirst();
  if (!existingMinOrder) {
    await prisma.minimumOrderSettings.create({
      data: { enabled: true, minimumAmount: 30 },
    });
  }

  // Subscription plans
  await prisma.subscriptionPlan.upsert({
    where: { id: 'plan-monthly-free' },
    update: {},
    create: {
      id: 'plan-monthly-free',
      name: 'Monthly Free Delivery',
      nameAr: 'توصيل مجاني شهري',
      price: 49,
      durationDays: 30,
      benefitType: 'FREE_DELIVERY',
      isActive: true,
    },
  });

  await prisma.subscriptionPlan.upsert({
    where: { id: 'plan-monthly-capped' },
    update: {},
    create: {
      id: 'plan-monthly-capped',
      name: 'Monthly Capped Delivery',
      nameAr: 'توصيل مخفض شهري',
      price: 29,
      durationDays: 30,
      benefitType: 'CAPPED_DELIVERY',
      cappedFee: 8,
      isActive: true,
    },
  });

  // Banner
  await prisma.banner.upsert({
    where: { id: 'banner-welcome' },
    update: {},
    create: {
      id: 'banner-welcome',
      title: 'Welcome to Al-Hathlul',
      titleAr: 'أهلاً بك في الهذلول',
      imageUrl: 'https://placehold.co/1200x400',
      sortOrder: 1,
      isActive: true,
    },
  });

  console.log('✓ Seed complete');
  console.log('');
  console.log('Staff login (POST /api/auth/staff/login):');
  console.log('  Admin  → admin@example.com  / Admin@123456');
  console.log('  Picker → picker@example.com / Picker@123456');
  console.log('  Driver → driver@example.com / Driver@123456');
  console.log('');
  console.log('Customer login (POST /api/auth/request-otp + verify-otp): mobile + OTP');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
