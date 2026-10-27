import vine from '@vinejs/vine'

export const createPlayerClaimValidator = vine.create({
  playerId: vine.number().positive().withoutDecimals(),
  leagueId: vine.number().positive().withoutDecimals(),
  seasonId: vine.number().positive().withoutDecimals(),
})
