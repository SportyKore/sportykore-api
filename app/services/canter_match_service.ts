import { DateTime } from 'luxon'
import { Exception } from '@adonisjs/core/exceptions'
import transmit from '@adonisjs/transmit/services/main'
import type { Broadcastable } from '@boringnode/transmit/types'
import logger from '@adonisjs/core/services/logger'
import CanterMatch from '#models/canter_match'
import CanterTurn from '#models/canter_turn'
import type User from '#models/user'
import { GOAL_TARGET, kickoffBodies, resolveTurn, type Body } from '#services/canter_physics'

const INVITE_TTL_MINUTES = 20
const TURN_SECONDS = 10

export default class CanterMatchService {
  broadcastChannel(match: CanterMatch) {
    return `canter-matches/${match.id}`
  }

  broadcast(match: CanterMatch, extra: Record<string, unknown> = {}) {
    try {
      transmit.broadcast(this.broadcastChannel(match), {
        type: 'match_updated',
        id: match.id,
        status: match.status,
        rulesMode: match.rulesMode,
        hostUserId: match.hostUserId,
        guestUserId: match.guestUserId,
        winnerUserId: match.winnerUserId,
        hostScore: match.hostScore,
        guestScore: match.guestScore,
        currentTurnUserId: match.currentTurnUserId,
        turnNumber: match.turnNumber,
        turnExpiresAt: match.turnExpiresAt?.toISO() ?? null,
        state: match.state,
        startedAt: match.startedAt?.toISO() ?? null,
        endedAt: match.endedAt?.toISO() ?? null,
        ...extra,
      } as Broadcastable)
    } catch (error) {
      logger.warn({ error, matchId: match.id }, 'Transmit canter match broadcast failed')
    }
  }

  async create(hostUser: User, rulesMode: 'street' = 'street') {
    const match = await CanterMatch.create({
      hostUserId: hostUser.id,
      status: 'pending',
      rulesMode,
      inviteCode: this.generateInviteCode(),
      inviteExpiresAt: DateTime.utc().plus({ minutes: INVITE_TTL_MINUTES }),
    })

    return match
  }

  async join(inviteCode: string, guestUser: User) {
    const match = await CanterMatch.query()
      .where('invite_code', inviteCode)
      .where('status', 'pending')
      .where('invite_expires_at', '>', DateTime.utc().toSQL())
      .first()

    if (!match) {
      throw new Exception('This invite is invalid or has expired', { status: 404 })
    }

    if (match.hostUserId === guestUser.id) {
      throw new Exception('You cannot join your own match', { status: 422 })
    }

    match.guestUserId = guestUser.id
    match.status = 'active'
    match.startedAt = DateTime.utc()
    match.currentTurnUserId = match.hostUserId
    match.turnExpiresAt = DateTime.utc().plus({ seconds: TURN_SECONDS })
    match.state = { bodies: kickoffBodies() }
    await match.save()

    this.broadcast(match)
    return match
  }

  async findForUser(matchId: number, user: User) {
    const match = await CanterMatch.find(matchId)

    if (!match || (match.hostUserId !== user.id && match.guestUserId !== user.id)) {
      throw new Exception('Match not found', { status: 404 })
    }

    return match
  }

  /** Public — matches are spectatable by anyone, no participant check. */
  async findForSpectator(matchId: number) {
    const match = await CanterMatch.query()
      .where('id', matchId)
      .preload('hostUser')
      .preload('guestUser')
      .first()

    if (!match) {
      throw new Exception('Match not found', { status: 404 })
    }

    return match
  }

  /** Public — currently-live matches, newest first, for the spectator list. */
  async listActive() {
    return CanterMatch.query()
      .where('status', 'active')
      .preload('hostUser')
      .preload('guestUser')
      .orderBy('started_at', 'desc')
  }

  /** Called by either player once their opponent's shot-clock has visibly run out. */
  async claimTimeout(match: CanterMatch, claimingUser: User) {
    if (match.status !== 'active') {
      throw new Exception('Match is not active', { status: 409 })
    }
    if (match.currentTurnUserId === claimingUser.id) {
      throw new Exception('You cannot claim a timeout on your own turn', { status: 422 })
    }
    if (!match.turnExpiresAt || match.turnExpiresAt > DateTime.utc()) {
      throw new Exception('The current turn has not expired yet', { status: 409 })
    }

    match.currentTurnUserId = claimingUser.id
    match.turnNumber += 1
    match.turnExpiresAt = DateTime.utc().plus({ seconds: TURN_SECONDS })
    await match.save()

    this.broadcast(match)
    return match
  }

  /**
   * Resolves one full turn server-side: applies the flick, simulates
   * physics to completion, persists the result, and broadcasts the frame
   * trajectory so both clients can animate the same shot.
   */
  async submitTurn(
    match: CanterMatch,
    shootingUser: User,
    input: { capId: string; dragX: number; dragY: number }
  ) {
    if (match.status !== 'active') {
      throw new Exception('Match is not active', { status: 409 })
    }
    if (match.currentTurnUserId !== shootingUser.id) {
      throw new Exception('It is not your turn', { status: 409 })
    }

    const shooterSide: 'host' | 'guest' = shootingUser.id === match.hostUserId ? 'host' : 'guest'
    if (!input.capId.startsWith(`${shooterSide}-`)) {
      throw new Exception('You can only flick your own caps', { status: 422 })
    }
    if (Math.hypot(input.dragX, input.dragY) < 10) {
      throw new Exception('Drag is too short to count as a shot', { status: 422 })
    }

    const storedState = match.state as { bodies: Body[] } | null
    if (!storedState?.bodies) {
      throw new Exception('Match has no live state to resolve a turn against', { status: 409 })
    }
    const bodies: Body[] = storedState.bodies.map((body) => ({ ...body }))

    const result = resolveTurn({
      bodies,
      shooterSide,
      capId: input.capId,
      drag: { x: input.dragX, y: input.dragY },
      lastTouch: match.lastTouch as 'host' | 'guest' | null,
      ownerHits: match.ownerHits,
      ownerRuleActive: true,
    })

    const opponentUserId = shooterSide === 'host' ? match.guestUserId! : match.hostUserId
    match.turnNumber += 1
    match.ownerHits = result.ownerHits
    match.lastTouch = result.lastTouch

    if (result.resultEvent.type === 'goal') {
      if (result.resultEvent.scoringSide === 'host') match.hostScore += 1
      else match.guestScore += 1

      if (match.hostScore >= GOAL_TARGET || match.guestScore >= GOAL_TARGET) {
        match.status = 'completed'
        match.winnerUserId =
          match.hostScore > match.guestScore ? match.hostUserId : match.guestUserId
        match.endedAt = DateTime.utc()
        match.turnExpiresAt = null
        match.currentTurnUserId = null
      } else {
        match.state = { bodies: kickoffBodies() }
        match.currentTurnUserId = opponentUserId
        match.turnExpiresAt = DateTime.utc().plus({ seconds: TURN_SECONDS })
      }
    } else if (result.resultEvent.type === 'owner' && result.resultEvent.stage === 'collect') {
      match.status = 'completed'
      match.winnerUserId = match.guestUserId
      match.endedAt = DateTime.utc()
      match.turnExpiresAt = null
      match.currentTurnUserId = null
    } else {
      match.state = { bodies }
      match.currentTurnUserId = opponentUserId
      match.turnExpiresAt = DateTime.utc().plus({ seconds: TURN_SECONDS })
    }

    await match.save()
    await CanterTurn.create({
      canterMatchId: match.id,
      userId: shootingUser.id,
      turnNumber: match.turnNumber,
      dragX: input.dragX,
      dragY: input.dragY,
      resultEvent: result.resultEvent.type === 'none' ? null : JSON.stringify(result.resultEvent),
    })

    this.broadcast(match, {
      type: 'turn_resolved',
      frames: result.frames,
      resultEvent: result.resultEvent,
    })
    return { match, frames: result.frames, resultEvent: result.resultEvent }
  }

  private generateInviteCode() {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 10)
  }
}
