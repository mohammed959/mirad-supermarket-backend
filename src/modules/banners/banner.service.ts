import { prisma } from '../../lib/prisma';

export async function listBanners(activeOnly = true) {
  return prisma.banner.findMany({
    where: activeOnly ? { isActive: true } : {},
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
  });
}

export async function getBanner(id: string) {
  return prisma.banner.findUnique({ where: { id } });
}

export interface BannerInput {
  title: string;
  titleAr: string;
  imageUrl: string;
  linkType?: string;
  linkValue?: string;
  sortOrder?: number;
  isActive?: boolean;
}

export async function createBanner(data: BannerInput) {
  return prisma.banner.create({ data });
}

export async function updateBanner(id: string, data: Partial<BannerInput>) {
  return prisma.banner.update({ where: { id }, data });
}

export async function toggleBanner(id: string, isActive: boolean) {
  return prisma.banner.update({ where: { id }, data: { isActive } });
}

export async function deleteBanner(id: string) {
  return prisma.banner.delete({ where: { id } });
}
