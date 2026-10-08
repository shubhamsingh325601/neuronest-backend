import { ApiProperty } from '@nestjs/swagger';
import { Escalation, EscalationStatus } from '@prisma/client';

export class EscalationClinicianDto {
  @ApiProperty() name!: string;
}

export class EscalationDto {
  @ApiProperty() id!: string;
  @ApiProperty() childId!: string;
  @ApiProperty() categoryId!: string;
  @ApiProperty() notes!: string;
  @ApiProperty({ type: String, nullable: true }) whatWasTried!: string | null;
  @ApiProperty({ type: String, nullable: true }) callbackPhone!: string | null;
  @ApiProperty({ enum: EscalationStatus }) status!: EscalationStatus;
  @ApiProperty({ type: String, format: 'date-time', description: 'createdAt + 24 h.' })
  dueAt!: Date;
  @ApiProperty({ description: 'Not resolved or cancelled and past `dueAt` (computed).' })
  overdue!: boolean;
  @ApiProperty({
    type: EscalationClinicianDto,
    nullable: true,
    description: "The child's assigned clinician.",
  })
  assignedClinician!: EscalationClinicianDto | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: "The clinician's note, shown to the parent.",
  })
  resolutionNote!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) acknowledgedAt!: Date | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) resolvedAt!: Date | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) cancelledAt!: Date | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;

  static from(
    row: Escalation,
    clinicianName: string | null,
    now: Date = new Date(),
  ): EscalationDto {
    const open =
      row.status === EscalationStatus.OPEN || row.status === EscalationStatus.ACKNOWLEDGED;
    return {
      id: row.id,
      childId: row.childId,
      categoryId: row.categoryId,
      notes: row.notes,
      whatWasTried: row.whatWasTried,
      callbackPhone: row.callbackPhone,
      status: row.status,
      dueAt: row.dueAt,
      overdue: open && row.dueAt.getTime() < now.getTime(),
      assignedClinician: clinicianName ? { name: clinicianName } : null,
      resolutionNote: row.resolutionNote,
      acknowledgedAt: row.acknowledgedAt,
      resolvedAt: row.resolvedAt,
      cancelledAt: row.cancelledAt,
      createdAt: row.createdAt,
    };
  }
}

export class EscalationPageDto {
  @ApiProperty({ type: [EscalationDto] }) data!: EscalationDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}
