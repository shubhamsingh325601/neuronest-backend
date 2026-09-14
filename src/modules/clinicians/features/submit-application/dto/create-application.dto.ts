import { ApiProperty } from '@nestjs/swagger';
import { ClinicianApplicationStatus } from '@prisma/client';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateApplicationDto {
  @ApiProperty({ example: 'Dr. Sam Okafor', minLength: 1, maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'sam.okafor@clinic.example' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({
    example: 'Paediatric OT, 8 years with ASD/ADHD caseloads. Interested in the pilot.',
    minLength: 1,
    maxLength: 2000,
    description: 'Free-text background / reason for applying.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  context!: string;
}

export class CreateApplicationResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ClinicianApplicationStatus, example: ClinicianApplicationStatus.PENDING })
  status!: ClinicianApplicationStatus;
}
