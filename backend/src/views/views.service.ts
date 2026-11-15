import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ViewsService {
  constructor(private readonly prisma: PrismaService) {}

  async listViews(userId: string) {
    const views = await this.prisma.view.findMany({
      where: { userId },
      include: {
        _count: { select: { bills: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return views.map((v) => ({
      id: v.id,
      name: v.name,
      billsCount: v._count.bills,
      createdAt: v.createdAt,
    }));
  }

  async createView(userId: string, name: string) {
    if (!name || typeof name !== 'string') throw new BadRequestException('View name cannot be empty');
    const cleanName = name.trim();
    if (!cleanName) throw new BadRequestException('View name cannot be empty');

    const existing = await this.prisma.view.findFirst({
      where: { userId, name: cleanName },
    });
    if (existing) throw new BadRequestException('A view with this name already exists');

    return this.prisma.view.create({
      data: { userId, name: cleanName },
    });
  }

  async addBillsToView(userId: string, viewId: string, billIds: string[]) {
    if (!viewId || typeof viewId !== 'string' || !viewId.trim()) {
      throw new BadRequestException('View ID is required');
    }
    if (!Array.isArray(billIds) || billIds.length === 0) {
      throw new BadRequestException('At least one bill ID must be provided');
    }

    const view = await this.prisma.view.findFirst({
      where: { id: viewId, userId },
    });
    if (!view) throw new NotFoundException('View not found');

    await this.prisma.bill.updateMany({
      where: { id: { in: billIds }, userId },
      data: { viewId },
    });

    return {
      success: true,
      message: `${billIds.length} bills moved to ${view.name}`,
    };
  }

  async listCategories() {
    // Default categories matching the prototype
    const defaults = [
      { name: 'Travel', subcategories: ['Flights', 'Taxi and Cab', 'Train'] },
      { name: 'Meals', subcategories: ['Client Meals', 'Team Meals'] },
      { name: 'Accommodation', subcategories: ['Hotel', 'Serviced Apartment'] },
      { name: 'Fuel', subcategories: ['Petrol', 'Diesel'] },
      { name: 'Office', subcategories: ['Stationery', 'Software'] },
    ];

    const stored = await this.prisma.category.findMany();
    if (!stored.length) {
      // Seed default categories
      for (const d of defaults) {
        await this.prisma.category.create({
          data: {
            name: d.name,
            subcategories: JSON.stringify(d.subcategories),
          },
        });
      }
      return defaults;
    }

    return stored.map((c) => ({
      name: c.name,
      subcategories: JSON.parse(c.subcategories),
    }));
  }

  async createCategory(name: string, subcategories: string[] = ['General']) {
    if (!name || typeof name !== 'string') throw new BadRequestException('Category name cannot be empty');
    const cleanName = name.trim();
    if (!cleanName) throw new BadRequestException('Category name cannot be empty');

    const existing = await this.prisma.category.findUnique({
      where: { name: cleanName },
    });
    if (existing) throw new BadRequestException('Category already exists');

    const created = await this.prisma.category.create({
      data: {
        name: cleanName,
        subcategories: JSON.stringify(subcategories.length ? subcategories : ['General']),
      },
    });

    return {
      name: created.name,
      subcategories: JSON.parse(created.subcategories),
    };
  }
}

