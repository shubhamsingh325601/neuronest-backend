import { ApiProperty } from '@nestjs/swagger';

/** A parent's notification and archive choices; a user with no saved row gets these defaults. */
export class PreferencesDto {
  @ApiProperty({ default: true, description: 'Tell me in the app when new weekly coaching tips are ready.' })
  coachingInApp!: boolean;

  @ApiProperty({ default: false, description: 'Also email me the weekly tips.' })
  coachingEmail!: boolean;

  @ApiProperty({ default: false, description: 'Also WhatsApp me the weekly tips.' })
  coachingWhatsapp!: boolean;

  @ApiProperty({ default: true, description: 'Remind me before monthly calls and about urgent-request updates.' })
  appointmentReminders!: boolean;

  @ApiProperty({ default: true, description: 'Keep call summaries in my care-plan archive.' })
  consultationArchive!: boolean;

  static from(row: Partial<PreferencesDto> | null): PreferencesDto {
    return {
      coachingInApp: row?.coachingInApp ?? true,
      coachingEmail: row?.coachingEmail ?? false,
      coachingWhatsapp: row?.coachingWhatsapp ?? false,
      appointmentReminders: row?.appointmentReminders ?? true,
      consultationArchive: row?.consultationArchive ?? true,
    };
  }
}