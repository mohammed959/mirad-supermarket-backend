import { prisma } from '../../lib/prisma';

export async function listAddresses(customerId: string) {
  return prisma.customerAddress.findMany({
    where: { customerId },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
  });
}

export async function getAddress(customerId: string, id: string) {
  return prisma.customerAddress.findFirst({ where: { id, customerId } });
}

export interface AddressInput {
  label?: string;
  addressLine?: string;
  city?: string;
  deliveryNotes?: string | null;
  latitude: number;
  longitude: number;
  isDefault?: boolean;
}

export async function createAddress(customerId: string, data: AddressInput) {
  return prisma.$transaction(async (tx) => {
    if (data.isDefault) {
      await tx.customerAddress.updateMany({
        where: { customerId, isDefault: true },
        data: { isDefault: false },
      });
    }
    const existingCount = await tx.customerAddress.count({ where: { customerId } });
    return tx.customerAddress.create({
      data: {
        customerId,
        label: data.label ?? 'Home',
        addressLine: data.addressLine,
        city: data.city,
        deliveryNotes: data.deliveryNotes ?? null,
        latitude: data.latitude,
        longitude: data.longitude,
        isDefault: data.isDefault ?? existingCount === 0,
      },
    });
  });
}

export async function updateAddress(customerId: string, id: string, data: Partial<AddressInput>) {
  return prisma.$transaction(async (tx) => {
    if (data.isDefault) {
      await tx.customerAddress.updateMany({
        where: { customerId, isDefault: true, NOT: { id } },
        data: { isDefault: false },
      });
    }
    return tx.customerAddress.update({
      where: { id },
      data,
    });
  });
}

export async function setDefault(customerId: string, id: string) {
  return prisma.$transaction(async (tx) => {
    await tx.customerAddress.updateMany({
      where: { customerId, isDefault: true },
      data: { isDefault: false },
    });
    return tx.customerAddress.update({
      where: { id },
      data: { isDefault: true },
    });
  });
}

export async function deleteAddress(customerId: string, id: string) {
  // Ensure the address belongs to the customer
  const owned = await prisma.customerAddress.findFirst({ where: { id, customerId } });
  if (!owned) return null;
  return prisma.customerAddress.delete({ where: { id } });
}
