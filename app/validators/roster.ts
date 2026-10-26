import vine from '@vinejs/vine'

const id = () => vine.number().positive().withoutDecimals()
export const rosterParamsValidator = vine.create({ leagueId: id(), seasonId: id() })
export const rosterListValidator = vine.create({ teamId: id().nullable().optional() })
export const rosterCreateValidator = vine.create({
  teamId: id().nullable(),
  names: vine.array(vine.string().trim().minLength(1).maxLength(255)).minLength(1).maxLength(200),
  confirmDuplicates: vine.boolean().optional(),
  requestId: vine.string().trim().minLength(1).maxLength(128),
})
export const rosterAssignValidator = vine.create({
  teamId: id(),
  rosterIds: vine.array(id()).minLength(1).maxLength(200).distinct(),
})
export const rosterApprovalValidator = vine.create({ status: vine.enum(['active', 'rejected']) })
export const rosterSettingsValidator = vine.create({
  requiresApproval: vine.boolean(),
})
export const rosterIdValidator = vine.create({ id: id() })
