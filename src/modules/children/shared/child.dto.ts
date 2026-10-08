import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Child } from '@prisma/client';
import { ClinicalProfileDto } from './clinical-profile.dto';

/** Full representation of a child, as returned to its parent, an assigned clinician, or admin. */
export class ChildDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  parentId!: string;

  @ApiProperty({ example: 'Alex' })
  name!: string;

  @ApiProperty({ type: String, format: 'date' })
  dateOfBirth!: Date;

  @ApiProperty({ type: String, nullable: true, description: 'What the family calls the child.' })
  preferredName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  gender!: string | null;

  @ApiProperty({ type: String, nullable: true })
  primaryLanguage!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Parent-written notes on accommodations.',
  })
  accommodations!: string | null;

  @ApiPropertyOptional({
    type: ClinicalProfileDto,
    nullable: true,
    description: 'Clinician-authored profile; null until a clinician writes one.',
  })
  clinicalProfile!: ClinicalProfileDto | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  static from(row: Child): ChildDto {
    return {
      id: row.id,
      parentId: row.parentId,
      name: row.name,
      dateOfBirth: row.dateOfBirth,
      preferredName: row.preferredName,
      gender: row.gender,
      primaryLanguage: row.primaryLanguage,
      accommodations: row.accommodations,
      clinicalProfile: (row.clinicalProfile as ClinicalProfileDto | null) ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
