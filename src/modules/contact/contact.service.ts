import { prisma } from '../../lib/prisma';

/**
 * Contact numbers are a singleton, same pattern as `HomeSettings` /
 * `MinimumOrderSettings` / etc. Read the one row, creating it with defaults
 * (both numbers unset) on first access so callers always get a concrete
 * value rather than having to special-case "no row yet".
 */
export async function getContactSettings() {
  const existing = await prisma.contactSettings.findFirst();
  if (existing) return existing;
  return prisma.contactSettings.create({ data: {} });
}

export interface UpdateContactSettingsInput {
  phone?: string | null;
  whatsapp?: string | null;
}

export async function updateContactSettings(data: UpdateContactSettingsInput) {
  const existing = await prisma.contactSettings.findFirst();
  if (existing) {
    return prisma.contactSettings.update({ where: { id: existing.id }, data });
  }
  return prisma.contactSettings.create({ data });
}
