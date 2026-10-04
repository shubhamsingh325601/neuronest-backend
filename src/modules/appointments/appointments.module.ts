import { Module } from '@nestjs/common';
import { CreateAppointmentController } from './features/create-appointment/create-appointment.controller';
import { CreateAppointmentService } from './features/create-appointment/create-appointment.service';
import { CreateSlotController } from './features/create-slot/create-slot.controller';
import { CreateSlotService } from './features/create-slot/create-slot.service';
import { ListAppointmentsController } from './features/list-appointments/list-appointments.controller';
import { ListAppointmentsService } from './features/list-appointments/list-appointments.service';
import { ListChildAppointmentsController } from './features/list-child-appointments/list-child-appointments.controller';
import { ListChildAppointmentsService } from './features/list-child-appointments/list-child-appointments.service';
import { ListSlotsController } from './features/list-slots/list-slots.controller';
import { ListSlotsService } from './features/list-slots/list-slots.service';

/** Monthly call appointments (Phase 14): published availability slots, then bookings. */
@Module({
  controllers: [
    CreateSlotController,
    ListSlotsController,
    CreateAppointmentController,
    ListChildAppointmentsController,
    ListAppointmentsController,
  ],
  providers: [
    CreateSlotService,
    ListSlotsService,
    CreateAppointmentService,
    ListChildAppointmentsService,
    ListAppointmentsService,
  ],
})
export class AppointmentsModule {}
