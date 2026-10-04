import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { ClinicianDetailDto } from '@modules/clinicians/shared/clinician-detail.dto';
import { findClinicianDetail } from '@modules/clinicians/shared/find-clinician-detail';

/** Admin reads one clinician: profile, lifecycle timestamps, and assigned children. */
@Injectable()
export class GetClinicianService {
  constructor(private readonly prisma: PrismaService) {}

  get(id: string): Promise<ClinicianDetailDto> {
    return findClinicianDetail(this.prisma, id);
  }
}
