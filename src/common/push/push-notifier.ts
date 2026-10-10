import { Injectable, Logger } from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { PushMessage, PushService } from './push.service';

/**
 * Works out who should hear about something that happened to a child, then pushes to them. Never
 * throws and never waits on Firebase for long, so callers can fire it after their own work is done.
 * Messages carry no child name or clinical detail: they show on a locked screen.
 */
@Injectable()
export class PushNotifier {
  private readonly logger = new Logger(PushNotifier.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  /** Every clinician assigned to the child. */
  async toClinicians(childId: string, message: PushMessage): Promise<void> {
    await this.safely(async () => {
      const assignments = await this.prisma.clinicianChildAssignment.findMany({
        where: { childId, clinician: { status: UserStatus.ACTIVE } },
        select: { clinicianId: true },
      });
      await this.push.sendToUsers(
        assignments.map((assignment) => assignment.clinicianId),
        message,
      );
    });
  }

  /** The child's parent, unless they switched appointment and urgent-request updates off. */
  async toParent(childId: string, message: PushMessage): Promise<void> {
    await this.safely(async () => {
      const child = await this.prisma.child.findUnique({
        where: { id: childId },
        select: { parentId: true },
      });
      if (!child) {
        return;
      }
      const preferences = await this.prisma.userPreference.findUnique({
        where: { userId: child.parentId },
        select: { appointmentReminders: true },
      });
      if (preferences && !preferences.appointmentReminders) {
        return;
      }
      await this.push.sendToUsers([child.parentId], message);
    });
  }

  private async safely(work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (err) {
      this.logger.error(
        `Push notification failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
