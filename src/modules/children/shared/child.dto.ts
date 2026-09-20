import { ApiProperty } from '@nestjs/swagger';
import { Child } from '@prisma/client';

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
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
