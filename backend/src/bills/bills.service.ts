import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CryptoService } from '../crypto/crypto.service';
import { OcrService, OcrResult } from '../ocr/ocr.service';
import { UploadBillDto } from './dto/upload-bill.dto';
import { ConfirmBillDto } from './dto/confirm-bill.dto';

@Injectable()
export class BillsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly cryptoService: CryptoService,
    private readonly ocrService: OcrService,
  ) {}

  /**
   * Upload bill image/PDF, encrypt and store, dispatch OCR extraction task.
   */
  async uploadBill(userId: string, file: Express.Multer.File, dto: UploadBillDto) {
    if (!file) {
      throw new BadRequestException('Please provide a bill image or PDF (max 10MB).');
    }

    if (dto.viewId) {
      const view = await this.prisma.view.findFirst({ where: { id: dto.viewId, userId } });
      if (!view) {
        throw new BadRequestException('The selected view does not exist.');
      }
    }

    // 1. Encrypt and save file to secure storage
    const stored = await this.storageService.saveEncryptedFile(file);

    let bill;
    try {
      // 2. Insert Bill in PROCESSING status
      const isPersonal = dto.isPersonal === 'true';
      bill = await this.prisma.bill.create({
        data: {
          userId,
          viewId: dto.viewId || null,
          category: dto.category || null,
          subcategory: dto.subcategory || null,
          isPersonal,
          status: 'PROCESSING',
          filePath: stored.filePath,
          fileHash: stored.fileHash,
          mimeType: file.mimetype,
          currency: 'INR',
        },
      });
    } catch (error) {
      await this.storageService.removeFile(stored.filePath);
      throw error;
    }

    // 3. Trigger asynchronous OCR in background
    this.processOcrInBackground(bill.id, file.buffer, file.mimetype);

    return {
      billId: bill.id,
      status: 'PROCESSING',
      message: 'Bill uploaded successfully. OCR extraction in progress.',
    };
  }

  private async processOcrInBackground(billId: string, buffer: Buffer, mimeType: string) {
    try {
      const ocrResult: OcrResult = await this.ocrService.processBillImage(buffer, mimeType);

      await this.prisma.bill.update({
        where: { id: billId },
        data: {
          status: ocrResult.isReceipt ? 'READY_FOR_REVIEW' : 'INVALID_DOCUMENT',
          extractionMeta: JSON.stringify(ocrResult),
        },
      });
    } catch (err) {
      console.error(`OCR processing failed for bill ${billId}:`, err);
      await this.prisma.bill.update({
        where: { id: billId },
        data: {
          status: 'NEEDS_REVIEW',
          extractionMeta: JSON.stringify({
            merchant: { value: '', confidence: 'missing' },
            date: { value: '', confidence: 'missing' },
            billNo: { value: '', confidence: 'missing' },
            total: { value: '', confidence: 'missing' },
            tax: { value: '', confidence: 'missing' },
            currency: { value: '', confidence: 'missing' },
            payment: { value: '', confidence: 'missing' },
            error: 'Local text extraction could not process this document. Enter the bill details manually.',
          }),
        },
      });
    }
  }

  /**
   * Polled by client to get OCR extraction status & detected fields.
   */
  async getExtraction(userId: string, billId: string) {
    const bill = await this.prisma.bill.findFirst({
      where: { id: billId, userId },
      include: { view: true },
    });

    if (!bill) {
      throw new NotFoundException('Bill not found');
    }

    const extraction = bill.extractionMeta ? JSON.parse(bill.extractionMeta) : null;

    return {
      id: bill.id,
      status: bill.status,
      extraction,
      currentView: bill.view ? { id: bill.view.id, name: bill.view.name } : null,
      category: bill.category,
      subcategory: bill.subcategory,
      isPersonal: bill.isPersonal,
    };
  }

  /**
   * User reviews and confirms extracted bill fields.
   */
  async confirmBill(userId: string, billId: string, dto: ConfirmBillDto) {
    const bill = await this.prisma.bill.findFirst({
      where: { id: billId, userId },
    });

    if (!bill) {
      throw new NotFoundException('Bill not found');
    }

    if (bill.status === 'INVALID_DOCUMENT') {
      throw new BadRequestException('This upload was not recognized as a bill or receipt and cannot be saved as an expense. Upload a clear bill, invoice, or receipt instead.');
    }

    if (dto.viewId) {
      const view = await this.prisma.view.findFirst({ where: { id: dto.viewId, userId } });
      if (!view) {
        throw new BadRequestException('The selected view does not exist.');
      }
    }

    // Encrypt sensitive values using AES-256-GCM
    const encryptedMerchant = this.cryptoService.encryptField(dto.merchant);
    const encryptedBillNo = this.cryptoService.encryptField(dto.billNo || '');
    const encryptedTotal = this.cryptoService.encryptField(dto.total);
    const encryptedTax = this.cryptoService.encryptField(dto.tax || '');
    const encryptedPayment = this.cryptoService.encryptField(dto.payment || '');

    // Determine status: VERIFIED or NEEDS_REVIEW
    const isComplete = dto.merchant && dto.total && dto.date;
    const status = isComplete ? 'VERIFIED' : 'NEEDS_REVIEW';

    const updated = await this.prisma.bill.update({
      where: { id: billId },
      data: {
        encryptedMerchant,
        encryptedBillNo,
        encryptedTotal,
        encryptedTax,
        encryptedPayment,
        date: dto.date || new Date().toISOString().slice(0, 10),
        currency: dto.currency || 'INR',
        viewId: dto.viewId || bill.viewId,
        category: dto.category || bill.category,
        subcategory: dto.subcategory || bill.subcategory,
        isPersonal: dto.isPersonal !== undefined ? dto.isPersonal : bill.isPersonal,
        status,
      },
      include: { view: true },
    });

    return {
      success: true,
      status: updated.status,
      billId: updated.id,
    };
  }

  /**
   * List bills with search and multi-criteria filtering.
   */
  async listBills(userId: string, query: { q?: string; viewId?: string; category?: string; dateFilter?: string; fromDate?: string; toDate?: string }) {
    const where: any = { userId };

    if (query.viewId) {
      where.viewId = query.viewId;
    }
    if (query.category) {
      where.category = query.category;
    }

    // Date filtering
    if (query.dateFilter === '30') {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
      where.date = { gte: thirtyDaysAgo };
    } else if (query.dateFilter === 'prev') {
      const now = new Date();
      const firstDayPrev = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
      const lastDayPrev = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10);
      where.date = { gte: firstDayPrev, lte: lastDayPrev };
    } else if (query.fromDate || query.toDate) {
      where.date = {};
      if (query.fromDate) where.date.gte = query.fromDate;
      if (query.toDate) where.date.lte = query.toDate;
    }

    const bills = await this.prisma.bill.findMany({
      where,
      include: { view: true, shares: true },
      orderBy: { createdAt: 'desc' },
    });

    // Decrypt sensitive fields for response
    const results = bills.map((b) => {
      const merchant = this.cryptoService.decryptField(b.encryptedMerchant);
      const billNo = this.cryptoService.decryptField(b.encryptedBillNo);
      const total = this.cryptoService.decryptField(b.encryptedTotal);
      const tax = this.cryptoService.decryptField(b.encryptedTax);
      const payment = this.cryptoService.decryptField(b.encryptedPayment);

      return {
        id: b.id,
        merchant: b.status === 'INVALID_DOCUMENT' ? 'Not a bill' : merchant || 'Unknown Merchant',
        billNo,
        total: b.status === 'INVALID_DOCUMENT' ? '' : total || '0.00',
        tax,
        currency: b.currency,
        payment,
        date: b.date,
        status: b.status,
        category: b.category,
        subcategory: b.subcategory,
        isPersonal: b.isPersonal,
        mimeType: b.mimeType,
        view: b.view ? { id: b.view.id, name: b.view.name } : null,
        sharesCount: b.shares.length,
        createdAt: b.createdAt,
      };
    });

    // In-memory search by merchant or bill number (since they are stored encrypted)
    if (query.q) {
      const term = query.q.toLowerCase();
      return results.filter((b) => 
        b.merchant.toLowerCase().includes(term) || (b.billNo && b.billNo.toLowerCase().includes(term))
      );
    }

    return results;
  }

  /**
   * Retrieve and decrypt the bill file buffer.
   */
  async getBillFile(userId: string, billId: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { contact: true } });
    if (!user) throw new NotFoundException('User not found');
    const activeShare = {
      OR: [
        { recipientId: userId },
        { recipientContact: user.contact },
      ],
      AND: [
        { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      ],
    };
    const bill = await this.prisma.bill.findFirst({
      where: {
        id: billId,
        OR: [
          { userId },
          { shares: { some: activeShare } },
          { view: { is: { shares: { some: activeShare } } } },
        ],
      },
    });

    if (!bill) {
      throw new NotFoundException('Bill not found or access denied');
    }

    return {
      buffer: await this.storageService.readDecryptedFile(bill.filePath, bill.fileHash),
      mimeType: bill.mimeType || 'application/octet-stream',
    };
  }

  /**
   * Move bill to a different view.
   */
  async moveBill(userId: string, billId: string, targetViewId: string) {
    const bill = await this.prisma.bill.findFirst({
      where: { id: billId, userId },
    });
    if (!bill) throw new NotFoundException('Bill not found');

    const view = await this.prisma.view.findFirst({
      where: { id: targetViewId, userId },
    });
    if (!view) throw new NotFoundException('Target view not found');

    await this.prisma.bill.update({
      where: { id: billId },
      data: { viewId: targetViewId },
    });

    return { success: true, message: `Moved to ${view.name}` };
  }
}
