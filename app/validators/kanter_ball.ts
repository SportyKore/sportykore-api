import vine from '@vinejs/vine'
import { resourceId } from '#validators/common'

/** Omit both to bootstrap a brand-new guest; pass `token` alone to refresh an
 * existing session; pass both to (re)name an existing guest. */
export const guestSessionValidator = vine.create({
  token: vine.string().trim().minLength(1).optional(),
  nickname: vine.string().trim().minLength(2).maxLength(24).optional(),
})

export const guestTokenValidator = vine.create({
  token: vine.string().trim().minLength(1),
})

export const startKanterMatchValidator = vine.create({
  token: vine.string().trim().minLength(1),
  difficulty: vine.enum(['easy', 'medium', 'hard']),
})

export const kanterMatchParamsValidator = vine.create({
  matchId: resourceId('canter_matches'),
})

export const finishKanterMatchValidator = vine.create({
  token: vine.string().trim().minLength(1),
  result: vine.enum(['win', 'draw', 'loss', 'owner_collect']),
  playerScore: vine.number().withoutDecimals().min(0).max(3),
  cpuScore: vine.number().withoutDecimals().min(0).max(3),
  durationSeconds: vine.number().min(0).max(3600),
  flicks: vine.number().withoutDecimals().min(0).max(500),
  ownerHits: vine.number().withoutDecimals().min(0).max(100),
  cleanSheet: vine.boolean(),
  comeback: vine.boolean(),
  clutchGoal: vine.boolean(),
  endedReason: vine.enum(['full_time', 'owner_collect', 'manual', 'abandoned']),
})

export const kanterLeaderboardValidator = vine.create({
  range: vine.enum(['week', 'all']).optional(),
  difficulty: vine.enum(['easy', 'medium', 'hard']).optional(),
  cleanSheet: vine.boolean().optional(),
  limit: vine.number().min(1).max(100).optional(),
})
