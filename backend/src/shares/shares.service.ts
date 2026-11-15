import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import { CreateShareDto } from './dto/create-share.dto';
import { normalizeContact } from '../common/contact';

@Injectable()
export class SharesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cryptoService: CryptoService,
  ) {}

  async listOutgoing(userId: string) {
    const shares = await this.prisma.share.findMany({
      where: {
        OR: [
          { bill: { is: { userId } } },
          { view: { is: { userId } } },
        ],
      },
      include: {
        bill: { include: { view: true } },
        view: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return shares.map((share) => ({
        id: share.id,
        targetType: share.billId ? 'bill' : 'view',
        targetId: share.billId || share.viewId,
        targetName: share.bill
          ? this.cryptoService.decryptField(share.bill.encryptedMerchant) || 'Unknown Merchant'
          : share.view?.name || '',
        recipientContact: share.recipientContact,
        expiresAt: share.expiresAt,
        createdAt: share.createdAt,
      }));
  }

  async listIncoming(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, contact: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const now = new Date();
    const shares = await this.prisma.share.findMany({
      where: {
        OR: [{ recipientId: userId }, { recipientContact: user.contact }],
        AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
      },
      include: {
        bill: { include: { user: true, view: true } },
        view: { include: { user: true, bills: { include: { view: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return shares.map((share) => {
      const owner = share.view?.user || share.bill?.user;
      const bills = share.view
        ? share.view.bills.map((bill) => this.presentBill(bill))
        : share.bill
          ? [this.presentBill(share.bill)]
          : [];

      return {
        id: share.id,
        name: share.view?.name || bills[0]?.merchant || 'Shared bill',
        by: {
          name: owner?.name || owner?.contact || 'Travelogue user',
          email: owner?.contact || '',
        },
        expiresAt: share.expiresAt,
        bills,
      };
    });
  }

  async create(userId: string, dto: CreateShareDto) {
    const contact = normalizeContact(dto.recipientContact);
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact);
    const digits = contact.replace(/\D/g, '');
    const isPhone = digits.length >= 10 && digits.length <= 15;
    if (!isEmail && !isPhone) {
      throw new BadRequestException('Enter a valid email address or mobile number.');
    }

    let target: { billId?: string; viewId?: string; name: string };
    if (dto.targetType === 'bill') {
      const bill = await this.prisma.bill.findFirst({ where: { id: dto.targetId, userId } });
      if (!bill) throw new NotFoundException('Bill not found');
      target = {
        billId: bill.id,
        name: this.cryptoService.decryptField(bill.encryptedMerchant) || 'Unknown Merchant',
      };
    } else {
      const view = await this.prisma.view.findFirst({ where: { id: dto.targetId, userId } });
      if (!view) throw new NotFoundException('View not found');
      target = { viewId: view.id, name: view.name };
    }

    const expiresAt = dto.expiresInDays
      ? new Date(Date.now() + dto.expiresInDays * 24 * 60 * 60 * 1000)
      : null;
    const recipient = await this.prisma.user.findUnique({
      where: { contact },
      select: { id: true },
    });
    const targetWhere = target.billId
      ? { billId: target.billId, viewId: null }
      : { viewId: target.viewId, billId: null };
    const existing = await this.prisma.share.findFirst({
      where: { ...targetWhere, recipientContact: contact },
    });

    const share = existing
      ? await this.prisma.share.update({
          where: { id: existing.id },
          data: { expiresAt, recipientId: recipient?.id || null },
        })
      : await this.prisma.share.create({
          data: {
            ...targetWhere,
            recipientContact: contact,
            recipientId: recipient?.id || null,
            expiresAt,
          },
        });

    return {
      id: share.id,
      targetType: dto.targetType,
      targetId: dto.targetId,
      targetName: target.name,
      recipientContact: share.recipientContact,
      expiresAt: share.expiresAt,
    };
  }

  async remove(userId: string, id: string) {
    const share = await this.prisma.share.findUnique({
      where: { id },
      include: { bill: true, view: true },
    });
    if (!share || (share.bill?.userId !== userId && share.view?.userId !== userId)) {
      throw new NotFoundException('Share not found');
    }

    await this.prisma.share.delete({ where: { id } });
    return { success: true };
  }

  private presentBill(bill: any) {
    const merchant = this.cryptoService.decryptField(bill.encryptedMerchant);
    const total = this.cryptoService.decryptField(bill.encryptedTotal);

    return {
      id: bill.id,
      merchant: bill.status === 'INVALID_DOCUMENT' ? 'Not a bill' : merchant || 'Unknown Merchant',
      billNo: this.cryptoService.decryptField(bill.encryptedBillNo),
      total: bill.status === 'INVALID_DOCUMENT' ? '' : total || '0.00',
      tax: this.cryptoService.decryptField(bill.encryptedTax),
      currency: bill.currency,
      payment: this.cryptoService.decryptField(bill.encryptedPayment),
      date: bill.date,
      status: bill.status,
      category: bill.category,
      subcategory: bill.subcategory,
      isPersonal: bill.isPersonal,
      mimeType: bill.mimeType,
      view: bill.view ? { id: bill.view.id, name: bill.view.name } : null,
    };
  }
}
