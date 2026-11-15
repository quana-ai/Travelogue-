import { IsOptional, IsString, IsBoolean } from 'class-validator';

export class ConfirmBillDto {
  @IsString()
  merchant: string;

  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  @IsString()
  billNo?: string;

  @IsString()
  total: string;

  @IsOptional()
  @IsString()
  tax?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  payment?: string;

  @IsOptional()
  @IsString()
  viewId?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  subcategory?: string;

  @IsOptional()
  @IsBoolean()
  isPersonal?: boolean;
}

