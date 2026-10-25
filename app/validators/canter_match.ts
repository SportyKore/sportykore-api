import vine from '@vinejs/vine'
import { resourceId } from '#validators/common'

// Street rules only for now — Football's throw-in/corner/goal-kick restart
// system isn't ported server-side yet.
export const createCanterMatchValidator = vine.create({
  rulesMode: vine.enum(['street']).optional(),
})

export const joinCanterMatchValidator = vine.create({
  inviteCode: vine.string().trim().minLength(1),
})

export const canterMatchParamsValidator = vine.create({
  matchId: resourceId('canter_matches'),
})

export const submitCanterTurnValidator = vine.create({
  capId: vine.string().regex(/^(host|guest)-[0-6]$/),
  dragX: vine.number().min(-1000).max(1000),
  dragY: vine.number().min(-1000).max(1000),
})
