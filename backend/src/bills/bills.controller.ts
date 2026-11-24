import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  UseInterceptors,
  UploadedFile,
  Res,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BillsService } from './bills.service';
import { UploadBillDto } from './dto/upload-bill.dto';
import { ConfirmBillDto } from './dto/confirm-bill.dto';
import { Response } from 'express';

@Controller('bills')
@UseGuards(JwtAuthGuard)
export class BillsController {
  constructor(private readonly billsService: BillsService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, callback) => {
      if (!file.mimetype.startsWith('image/') && file.mimetype !== 'application/pdf') {
        callback(
          new BadRequestException({
            statusCode: 400,
            error: 'INVALID_FILE_TYPE',
            code: 'INVALID_FILE_TYPE',
            message: 'Only image or PDF files are supported.',
          }),
          false,
        );
        return;
      }
      callback(null, true);
    },
  }))
  async uploadBill(
    @Req() req,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadBillDto,
  ) {
    return this.billsService.uploadBill(req.user.id, file, dto);
  }

  @Get(':id/extraction')
  async getExtraction(@Req() req, @Param('id') id: string) {
    return this.billsService.getExtraction(req.user.id, id);
  }

  @Post(':id/confirm')
  async confirmBill(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: ConfirmBillDto,
  ) {
    return this.billsService.confirmBill(req.user.id, id, dto);
  }

  @Get()
  async listBills(
    @Req() req,
    @Query('q') q?: string,
    @Query('viewId') viewId?: string,
    @Query('category') category?: string,
    @Query('dateFilter') dateFilter?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('deleted') deleted?: string,
  ) {
    return this.billsService.listBills(req.user.id, {
      q,
      viewId,
      category,
      dateFilter,
      fromDate,
      toDate,
      deleted: deleted === 'true',
    });
  }

  @Get(':id/file')
  async getBillFile(
    @Req() req,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const file = await this.billsService.getBillFile(req.user.id, id);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Cache-Control', 'private, no-store');
    const extension = file.mimeType === 'application/pdf' ? 'pdf' : 'img';
    res.setHeader('Content-Disposition', `inline; filename="bill-${id}.${extension}"`);
    res.send(file.buffer);
  }

  @Post(':id/move')
  async moveBill(
    @Req() req,
    @Param('id') id: string,
    @Body('viewId') targetViewId: string,
  ) {
    return this.billsService.moveBill(req.user.id, id, targetViewId);
  }

  @Delete(':id')
  async deleteBill(@Req() req, @Param('id') id: string, @Query('permanent') permanent?: string) {
    return permanent === 'true'
      ? this.billsService.deleteBillPermanently(req.user.id, id)
      : this.billsService.deleteBill(req.user.id, id);
  }

  @Post(':id/restore')
  async restoreBill(@Req() req, @Param('id') id: string) {
    return this.billsService.restoreBill(req.user.id, id);
  }
}
