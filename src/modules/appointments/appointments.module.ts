import { Module } from '@nestjs/common';
import { CancelAppointmentController } from './features/cancel-appointment/cancel-appointment.controller';
import { CancelAppointmentService } from './features/cancel-appointment/cancel-appointment.service';
import { CreateAppointmentController } from './features/create-appointment/create-appointment.controller';
import { CreateAppointmentService } from './features/create-appointment/create-appointment.service';
import { CreateSlotController } from './features/create-slot/create-slot.controller';
import { CreateSlotService } from './features/create-slot/create-slot.service';
import { ListAppointmentsController } from './features/list-appointments/list-appointments.controller';
import { ListAppointmentsService } from './features/list-appointments/list-appointments.service';
import { ListChildAppointmentsController } from './features/list-child-appointments/list-child-appointments.controller';
import { ListChildAppointmentsService } from './features/list-child-appointments/list-child-appointments.service';
import { SavePreparationController } from './features/save-preparation/save-preparation.controller';
import { SavePreparationService } from './features/save-preparation/save-preparation.service';
import { SetSummaryController } from './features/set-summary/set-summary.controller';
import { SetSummaryService } from './features/set-summary/set-summary.service';
import { ListSlotsController } from './features/list-slots/list-slots.controller';
import { ListSlotsService } from './features/list-slots/list-slots.service';

/** Monthly call appointments (Phase 14): published availability slots, then bookings. */
@Module({
  controllers: [
    CreateSlotController,
    ListSlotsController,
    CreateAppointmentController,
    CancelAppointmentController,
    SavePreparationController,
    SetSummaryController,
    ListChildAppointmentsController,
    ListAppointmentsController,
  ],
  providers: [
    CreateSlotService,
    ListSlotsService,
    CreateAppointmentService,
    CancelAppointmentService,
    SavePreparationService,
    SetSummaryService,
    ListChildAppointmentsService,
    ListAppointmentsService,
  ],
})
export class AppointmentsModule {}
