import { z } from 'zod';
import { jdAreaSchema } from './areas.ts';

export const cascadeTierSchema = z.enum(['portfolio', 'program', 'project']);
export type CascadeTier = z.infer<typeof cascadeTierSchema>;

export const mapRelationSchema = z.enum(['owns', 'supports', 'funds', 'reports_on']);
export type MapRelation = z.infer<typeof mapRelationSchema>;

export const placedEntityKindSchema = z.enum(['page', 'task', 'item']);
export type PlacedEntityKind = z.infer<typeof placedEntityKindSchema>;

const note = z
  .string()
  .max(280)
  .refine((value) => value.trim().length > 0, 'a note is not blank')
  .nullable()
  .default(null);

export const declareJdMapCommandSchema = z.object({
  command: z.literal('declare_jd_map'),
  requestId: z.uuid(),
  jdArea: jdAreaSchema,
  cascadePageId: z.uuid(),
  relation: mapRelationSchema,
  note,
});
export type DeclareJdMapCommand = z.infer<typeof declareJdMapCommandSchema>;

export const removeJdMapCommandSchema = z.object({
  command: z.literal('remove_jd_map'),
  requestId: z.uuid(),
  mapId: z.uuid(),
});
export type RemoveJdMapCommand = z.infer<typeof removeJdMapCommandSchema>;

export const placeInCascadeCommandSchema = z.object({
  command: z.literal('place_in_cascade'),
  requestId: z.uuid(),
  entityKind: placedEntityKindSchema,
  entityId: z.uuid(),
  cascadePageId: z.uuid().nullable(),
});
export type PlaceInCascadeCommand = z.infer<typeof placeInCascadeCommandSchema>;

const mapLinkSchema = z.object({
  mapId: z.uuid(),
  cascadePageId: z.uuid(),
  title: z.string(),
  relation: mapRelationSchema,
  note: z.string().nullable(),
});
export type MapLink = z.infer<typeof mapLinkSchema>;

const entityCountsSchema = z.object({
  pages: z.number().int().min(0),
  tasks: z.number().int().min(0),
  items: z.number().int().min(0),
});
export type EntityCounts = z.infer<typeof entityCountsSchema>;

const crosswalkCellSchema = z.object({
  tier: cascadeTierSchema,
  counts: entityCountsSchema,
  links: z.array(mapLinkSchema),
});
export type CrosswalkCell = z.infer<typeof crosswalkCellSchema>;

const crosswalkRowSchema = z.object({
  jdArea: jdAreaSchema,
  cells: z.array(crosswalkCellSchema),
  unplaced: entityCountsSchema,
});
export type CrosswalkRow = z.infer<typeof crosswalkRowSchema>;

export const crosswalkReplySchema = z.object({
  tiers: z.array(cascadeTierSchema),
  rows: z.array(crosswalkRowSchema),
});
export type CrosswalkReply = z.infer<typeof crosswalkReplySchema>;

const nodeAreaSchema = z.object({
  jdArea: jdAreaSchema,
  counts: entityCountsSchema,
  links: z.array(mapLinkSchema),
});

export const cascadeNodeReplySchema = z.object({
  cascadePageId: z.uuid(),
  title: z.string(),
  tier: cascadeTierSchema,
  areas: z.array(nodeAreaSchema),
});
export type CascadeNodeReply = z.infer<typeof cascadeNodeReplySchema>;
