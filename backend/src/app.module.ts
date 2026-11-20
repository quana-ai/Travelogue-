import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { CryptoModule } from './crypto/crypto.module';
import { StorageModule } from './storage/storage.module';
import { OcrModule } from './ocr/ocr.module';
import { BillsModule } from './bills/bills.module';
import { ViewsModule } from './views/views.module';
import { SharesModule } from './shares/shares.module';
import { NotificationModule } from './notifications/notification.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    NotificationModule,
    AuthModule,
    CryptoModule,
    StorageModule,
    OcrModule,
    BillsModule,
    ViewsModule,
    SharesModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule { }
