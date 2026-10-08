import { ApiProperty } from '@nestjs/swagger';
import type { Prisma } from '@prisma/client';
import {
  ActivityStepInputDto,
  ParentScriptInputDto,
  WeekGuidanceInputDto,
} from '@modules/care-plan/features/upsert-plan-week/dto/upsert-plan-week.dto';

export type WeekStatus = 'completed' | 'current' | 'upcoming';
export type GoalStatus = 'in_progress' | 'achieved' | 'upcoming';

export class CarePlanGoalDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() description!: string;
  @ApiProperty() domain!: string;
  @ApiProperty({ type: String, nullable: true }) icon!: string | null;
  @ApiProperty({ enum: ['in_progress', 'achieved', 'upcoming'] }) status!: GoalStatus;
}

export class CarePlanActivityDto {
  @ApiProperty() id!: string;
  @ApiProperty() weekNumber!: number;
  @ApiProperty() dayOfWeek!: number;
  @ApiProperty() title!: string;
  @ApiProperty() shortDescription!: string;
  @ApiProperty() goalCategory!: string;
  @ApiProperty() domain!: string;
  @ApiProperty() durationMinutes!: number;
  @ApiProperty() whyItMatters!: string;
  @ApiProperty({ type: [ActivityStepInputDto] }) steps!: ActivityStepInputDto[];
  @ApiProperty({ type: ParentScriptInputDto, nullable: true })
  parentScript!: ParentScriptInputDto | null;
  @ApiProperty({ type: [String] }) equipment!: string[];
  @ApiProperty({ type: String, nullable: true }) clinicalReassurance!: string | null;
  @ApiProperty() isCompleted!: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) completedAt!: Date | null;
  @ApiProperty({ type: String, nullable: true }) completionNote!: string | null;
}

export class CarePlanWeekDto {
  @ApiProperty() weekNumber!: number;
  @ApiProperty() title!: string;
  @ApiProperty() focus!: string;
  @ApiProperty({ enum: ['completed', 'current', 'upcoming'] }) status!: WeekStatus;
  @ApiProperty({ type: WeekGuidanceInputDto, nullable: true })
  guidance!: WeekGuidanceInputDto | null;
  @ApiProperty() progressPercentage!: number;
  @ApiProperty() completedActivitiesCount!: number;
  @ApiProperty() totalActivitiesCount!: number;
  @ApiProperty({ type: [CarePlanGoalDto] }) goals!: CarePlanGoalDto[];
  @ApiProperty({ type: [CarePlanActivityDto] }) activities!: CarePlanActivityDto[];
}

export class CarePlanClinicianDto {
  @ApiProperty() name!: string;
}

export class CarePlanDto {
  @ApiProperty() planId!: string;
  @ApiProperty({ type: String, format: 'date' }) startDate!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) approvedAt!: Date;
  @ApiProperty({
    type: CarePlanClinicianDto,
    nullable: true,
    description: "The child's assigned clinician.",
  })
  clinician!: CarePlanClinicianDto | null;
  @ApiProperty({ description: '1-based; clamped to the plan range.' }) currentWeek!: number;
  @ApiProperty({ description: '1..7 within the current week.' }) currentDayOfWeek!: number;
  @ApiProperty() totalWeeks!: number;
  @ApiProperty({ type: [CarePlanWeekDto] }) weeks!: CarePlanWeekDto[];
}

type ActivityRow = Prisma.PlanActivityGetPayload<{ include: { completion: true } }>;
type WeekRow = Prisma.PlanWeekGetPayload<{
  include: { goals: true; activities: { include: { completion: true } } };
}>;

export function toActivityDto(row: ActivityRow, weekNumber: number): CarePlanActivityDto {
  return {
    id: row.id,
    weekNumber,
    dayOfWeek: row.dayOfWeek,
    title: row.title,
    shortDescription: row.shortDescription,
    goalCategory: row.goalCategory,
    domain: row.domain,
    durationMinutes: row.durationMinutes,
    whyItMatters: row.whyItMatters,
    steps: row.steps as unknown as ActivityStepInputDto[],
    parentScript: (row.parentScript as unknown as ParentScriptInputDto | null) ?? null,
    equipment: (row.equipment as unknown as string[]) ?? [],
    clinicalReassurance: row.clinicalReassurance ?? null,
    isCompleted: row.completion !== null,
    completedAt: row.completion?.completedAt ?? null,
    completionNote: row.completion?.note ?? null,
  };
}

/** Builds one week for the client; `currentWeek` decides its status. */
export function toWeekDto(row: WeekRow, currentWeek: number): CarePlanWeekDto {
  const activities = [...row.activities]
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.position - b.position)
    .map((a) => toActivityDto(a, row.weekNumber));
  const completed = activities.filter((a) => a.isCompleted).length;
  const total = activities.length;
  const status: WeekStatus =
    row.weekNumber < currentWeek
      ? 'completed'
      : row.weekNumber === currentWeek
        ? 'current'
        : 'upcoming';
  const goalStatus: GoalStatus =
    status === 'upcoming'
      ? 'upcoming'
      : total > 0 && completed === total
        ? 'achieved'
        : 'in_progress';
  return {
    weekNumber: row.weekNumber,
    title: row.title,
    focus: row.focus,
    status,
    guidance: (row.guidance as unknown as WeekGuidanceInputDto | null) ?? null,
    progressPercentage: total === 0 ? 0 : Math.round((completed / total) * 100),
    completedActivitiesCount: completed,
    totalActivitiesCount: total,
    goals: [...row.goals]
      .sort((a, b) => a.position - b.position)
      .map((g) => ({
        id: g.id,
        title: g.title,
        description: g.description,
        domain: g.domain,
        icon: g.icon ?? null,
        status: goalStatus,
      })),
    activities,
  };
}

export const WEEK_INCLUDE = {
  goals: true,
  activities: { include: { completion: true } },
} as const;
