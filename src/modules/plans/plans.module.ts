import { Module } from '@nestjs/common';
import { CreatePlanTemplateController } from './features/create-plan-template/create-plan-template.controller';
import { CreatePlanTemplateService } from './features/create-plan-template/create-plan-template.service';
import { ListPlanTemplatesController } from './features/list-plan-templates/list-plan-templates.controller';
import { ListPlanTemplatesService } from './features/list-plan-templates/list-plan-templates.service';
import { GetPlanTemplateController } from './features/get-plan-template/get-plan-template.controller';
import { GetPlanTemplateService } from './features/get-plan-template/get-plan-template.service';
import { PublishPlanTemplateController } from './features/publish-plan-template/publish-plan-template.controller';
import { PublishPlanTemplateService } from './features/publish-plan-template/publish-plan-template.service';
import { AssignPlanController } from './features/assign-plan/assign-plan.controller';
import { AssignPlanService } from './features/assign-plan/assign-plan.service';
import { CompletePlanController } from './features/complete-plan/complete-plan.controller';
import { CompletePlanService } from './features/complete-plan/complete-plan.service';
import { ArchivePlanController } from './features/archive-plan/archive-plan.controller';
import { ArchivePlanService } from './features/archive-plan/archive-plan.service';
import { TodayFocusController } from './features/today-focus/today-focus.controller';
import { TodayFocusService } from './features/today-focus/today-focus.service';
import { CreatePlanNoteController } from './features/create-plan-note/create-plan-note.controller';
import { CreatePlanNoteService } from './features/create-plan-note/create-plan-note.service';
import { ListPlanNotesController } from './features/list-plan-notes/list-plan-notes.controller';
import { ListPlanNotesService } from './features/list-plan-notes/list-plan-notes.service';
import { ListPlansController } from './features/list-plans/list-plans.controller';
import { ListPlansService } from './features/list-plans/list-plans.service';
import { GetPlanController } from './features/get-plan/get-plan.controller';
import { GetPlanService } from './features/get-plan/get-plan.service';
import { ArchivePlanTemplateController } from './features/archive-plan-template/archive-plan-template.controller';
import { ArchivePlanTemplateService } from './features/archive-plan-template/archive-plan-template.service';
import { ClonePlanTemplateController } from './features/clone-plan-template/clone-plan-template.controller';
import { ClonePlanTemplateService } from './features/clone-plan-template/clone-plan-template.service';
import { ReplacePlanTemplateContentController } from './features/replace-plan-template-content/replace-plan-template-content.controller';
import { ReplacePlanTemplateContentService } from './features/replace-plan-template-content/replace-plan-template-content.service';
import { UpsertPlanDayController } from './features/upsert-plan-day/upsert-plan-day.controller';
import { UpsertPlanDayService } from './features/upsert-plan-day/upsert-plan-day.service';
import { DeletePlanDayController } from './features/delete-plan-day/delete-plan-day.controller';
import { DeletePlanDayService } from './features/delete-plan-day/delete-plan-day.service';
import { ReplacePlanSectionsController } from './features/replace-plan-sections/replace-plan-sections.controller';
import { ReplacePlanSectionsService } from './features/replace-plan-sections/replace-plan-sections.service';

/**
 * Plan domain (Phase 6): admin-owned reusable template library (`PlanTemplate` +
 * `PlanTemplateDay`), clinician-managed per-child assignment/lifecycle (`Plan`), and
 * clinician-to-clinician coordination notes (`PlanNote`). Depends on `children`'s
 * `Child`/`ClinicianChildAssignment` tables directly via Prisma — no cross-module
 * service import, consistent with "no repository layer."
 */
@Module({
  controllers: [
    CreatePlanTemplateController,
    ListPlanTemplatesController,
    GetPlanTemplateController,
    PublishPlanTemplateController,
    AssignPlanController,
    CompletePlanController,
    ArchivePlanController,
    TodayFocusController,
    CreatePlanNoteController,
    ListPlanNotesController,
    ListPlansController,
    GetPlanController,
    ArchivePlanTemplateController,
    ClonePlanTemplateController,
    ReplacePlanTemplateContentController,
    UpsertPlanDayController,
    DeletePlanDayController,
    ReplacePlanSectionsController,
  ],
  providers: [
    CreatePlanTemplateService,
    ListPlanTemplatesService,
    GetPlanTemplateService,
    PublishPlanTemplateService,
    AssignPlanService,
    CompletePlanService,
    ArchivePlanService,
    TodayFocusService,
    CreatePlanNoteService,
    ListPlanNotesService,
    ListPlansService,
    GetPlanService,
    ArchivePlanTemplateService,
    ClonePlanTemplateService,
    ReplacePlanTemplateContentService,
    UpsertPlanDayService,
    DeletePlanDayService,
    ReplacePlanSectionsService,
  ],
})
export class PlansModule {}
