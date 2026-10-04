import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ClinicianProfile } from '@prisma/client';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Admin-supplied profile fields. `null` clears a field on update. */
export class ClinicianProfileInputDto {
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 40 })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  specialisation?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  qualifications?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  licenseNumber?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string | null;
}

/** Profile as returned to admin. Every field is null for a clinician with no profile row. */
export class ClinicianProfileDto {
  @ApiProperty({ type: String, nullable: true })
  phone!: string | null;

  @ApiProperty({ type: String, nullable: true })
  specialisation!: string | null;

  @ApiProperty({ type: String, nullable: true })
  qualifications!: string | null;

  @ApiProperty({ type: String, nullable: true })
  licenseNumber!: string | null;

  @ApiProperty({ type: String, nullable: true })
  bio!: string | null;

  static from(row: ClinicianProfile | null): ClinicianProfileDto {
    return {
      phone: row?.phone ?? null,
      specialisation: row?.specialisation ?? null,
      qualifications: row?.qualifications ?? null,
      licenseNumber: row?.licenseNumber ?? null,
      bio: row?.bio ?? null,
    };
  }
}
