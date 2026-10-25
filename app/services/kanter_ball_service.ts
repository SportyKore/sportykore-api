import { DateTime } from 'luxon'
import { Exception } from '@adonisjs/core/exceptions'
import db from '@adonisjs/lucid/services/db'
import CanterMatch from '#models/canter_match'
import CanterMatchEvent from '#models/canter_match_event'
import KanterBallPlayer from '#models/kanter_ball_player'
import KanterBallGuestSession from '#models/kanter_ball_guest_session'
import User from '#models/user'
import {
  calculateRating,
  type Difficulty,
  type MatchResult,
  type RatingInput,
} from '#services/kanter_rating'

import { validateFinish } from '#services/kanter_finish_validation'

const GUEST_SESSION_TTL_DAYS = 30
const MATCH_SECONDS = 120

export default class KanterBallService {
  // ---- Guest identity -----------------------------------------------

  /**
   * Bootstraps a new guest, refreshes a returning one, or renames an
   * existing one — see guestSessionValidator for which combination of
   * {token, nickname} does which.
   */
  async upsertGuestSession(input: { token?: string; nickname?: string }) {
    if (input.token) {
      const session = await KanterBallGuestSession.query()
        .where('token', input.token)
        .where('expires_at', '>', DateTime.utc().toSQL())
        .preload('kanterPlayer')
        .first()

      if (session) {
        if (input.nickname && input.nickname !== session.kanterPlayer.nickname) {
          await this.renameGuest(session.kanterPlayer, input.nickname)
        }
        session.expiresAt = DateTime.utc().plus({ days: GUEST_SESSION_TTL_DAYS })
        await session.save()
        return { player: session.kanterPlayer, session }
      }
      // Token missing/expired/unknown — fall through and issue a new one.
    }

    const player = await this.createGuestPlayer(input.nickname)
    const session = await KanterBallGuestSession.create({
      kanterPlayerId: player.id,
      token: this.generateToken(),
      expiresAt: DateTime.utc().plus({ days: GUEST_SESSION_TTL_DAYS }),
    })
    return { player, session }
  }

  private async createGuestPlayer(requestedNickname?: string): Promise<KanterBallPlayer> {
    const nickname = requestedNickname ?? (await this.generateNickname())

    if (requestedNickname) {
      const taken = await KanterBallPlayer.query().where('nickname', requestedNickname).first()
      if (taken) {
        throw new Exception('That nickname is already taken', { status: 422 })
      }
    }

    try {
      return await KanterBallPlayer.create({ nickname })
    } catch (error) {
      // Belt-and-braces for the rename check's race window: two guests
      // requesting the same brand-new nickname in the same instant both
      // pass the SELECT above, and only one INSERT wins. Surface that as
      // the same clean 422 rather than leaking the raw DB error.
      if (this.isUniqueNicknameViolation(error)) {
        throw new Exception('That nickname is already taken', { status: 422 })
      }
      throw error
    }
  }

  private isUniqueNicknameViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === '23505' &&
      'constraint' in error &&
      (error as { constraint?: unknown }).constraint === 'kanter_ball_players_nickname_unique'
    )
  }

  /** Resolves and validates a guest session token — the auth guard for every
   * solo-match action, whether or not that player has since saved a profile. */
  async requireGuestPlayer(token: string): Promise<KanterBallPlayer> {
    const session = await KanterBallGuestSession.query()
      .where('token', token)
      .where('expires_at', '>', DateTime.utc().toSQL())
      .preload('kanterPlayer')
      .first()

    if (!session) {
      throw new Exception('Guest session is invalid or has expired', { status: 401 })
    }
    return session.kanterPlayer
  }

  private async renameGuest(player: KanterBallPlayer, nickname: string) {
    const taken = await KanterBallPlayer.query()
      .where('nickname', nickname)
      .whereNot('id', player.id)
      .first()
    if (taken) {
      throw new Exception('That nickname is already taken', { status: 422 })
    }
    player.nickname = nickname
    await player.save()
  }

  private async generateNickname(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = `Guest${Math.floor(1000 + Math.random() * 9000)}`
      const taken = await KanterBallPlayer.query().where('nickname', candidate).first()
      if (!taken) return candidate
    }
    // Astronomically unlikely to still collide — fall back to something
    // unique by construction.
    return `Guest${Date.now().toString(36)}`
  }

  private generateToken(): string {
    return crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
  }

  // ---- Matches ---------------------------------------------------------

  async startMatch(player: KanterBallPlayer, difficulty: Difficulty) {
    const match = await CanterMatch.create({
      matchType: 'solo',
      kanterPlayerId: player.id,
      status: 'active',
      rulesMode: 'street',
      difficulty,
      seed: crypto.randomUUID(),
      startedAt: DateTime.utc(),
    })

    return match
  }

  async finishMatch(
    token: string,
    matchId: number,
    input: {
      result: MatchResult
      playerScore: number
      cpuScore: number
      durationSeconds: number
      flicks: number
      ownerHits: number
      cleanSheet: boolean
      comeback: boolean
      clutchGoal: boolean
      endedReason: string
    }
  ) {
    return db.transaction(async (trx) => {
      const match = await CanterMatch.query({ client: trx })
        .forUpdate()
        .where('id', matchId)
        .where('match_type', 'solo')
        .first()

      if (!match) {
        throw new Exception('Match not found', { status: 404 })
      }
      // Lock the match before resolving identity. A profile merge updates matches
      // before sessions, so it either finishes first or waits for this completion.
      const session = await KanterBallGuestSession.query({ client: trx })
        .where('token', token)
        .where('expires_at', '>', DateTime.utc().toSQL())
        .first()
      if (!session) throw new Exception('Guest session is invalid or has expired', { status: 401 })
      if (session.kanterPlayerId !== match.kanterPlayerId) {
        throw new Exception('Match not found', { status: 404 })
      }

      if (match.status !== 'active') {
        // One finish per match — a retried/duplicated submit is a no-op, not an error.
        return match
      }
      if (!match.startedAt) {
        throw new Exception('Match has no start time to validate against', { status: 409 })
      }

      const elapsedSeconds = DateTime.utc().diff(match.startedAt, 'seconds').seconds
      const validationError = validateFinish(input, elapsedSeconds)
      if (validationError) throw new Exception(validationError, { status: 422 })

      // A manual quit still has a real score line (worth keeping for the
      // player's own history) but isn't a completed competitive match.
      match.status = ['manual', 'abandoned'].includes(input.endedReason) ? 'abandoned' : 'completed'
      match.result = input.result
      match.playerScore = input.playerScore
      match.cpuScore = input.cpuScore
      match.durationSeconds = Math.round(input.durationSeconds)
      match.flicks = input.flicks
      match.ownerHits = input.ownerHits
      match.cleanSheet = input.cleanSheet
      match.comeback = input.comeback
      match.clutchGoal = input.clutchGoal
      match.endedReason = input.endedReason
      match.endedAt = DateTime.utc()

      // No rating/leaderboard entry for an owner-collected or manually-quit
      // match — casual mode voids the former ("chaos is the fun"), and the
      // latter was never actually finished. Everything else is scored
      // server-side; the client's own number is never trusted.
      const isRated = input.result !== 'owner_collect' && input.endedReason === 'full_time'
      if (isRated) {
        const ratingInput: RatingInput = {
          result: input.result,
          difficulty: match.difficulty as Difficulty,
          playerScore: input.playerScore,
          cpuScore: input.cpuScore,
          matchSeconds: MATCH_SECONDS,
          durationSeconds: input.durationSeconds,
          flicks: input.flicks,
          ownerHits: input.ownerHits,
          cleanSheet: input.cleanSheet,
          comeback: input.comeback,
          clutchGoal: input.clutchGoal,
        }
        const breakdown = calculateRating(ratingInput)
        match.rating = breakdown.rating
        match.ratingFormulaVersion = breakdown.formulaVersion
      }

      match.useTransaction(trx)
      await match.save()
      await CanterMatchEvent.create(
        {
          canterMatchId: match.id,
          eventType:
            input.result === 'owner_collect'
              ? 'owner_collect'
              : ['manual', 'abandoned'].includes(input.endedReason)
                ? 'match_abandoned'
                : 'match_completed',
          side: 'player',
          payload: {
            result: input.result,
            playerScore: input.playerScore,
            cpuScore: input.cpuScore,
            rating: match.rating,
          },
        },
        { client: trx }
      )

      return match
    })
  }

  // ---- Leaderboard -------------------------------------------------------

  async leaderboard(filters: {
    range?: 'week' | 'all'
    difficulty?: Difficulty
    cleanSheet?: boolean
    limit?: number
  }) {
    // Aggregate all eligible matches before applying the top-player limit.
    const query = db
      .from('canter_matches as matches')
      .join('kanter_ball_players as players', 'players.id', 'matches.kanter_player_id')
      .where('matches.match_type', 'solo')
      .where('matches.status', 'completed')
      .whereNotNull('matches.rating')
      .select('players.id as playerId', 'players.nickname')
      .count('* as gamesPlayed')
      .sum('matches.rating as rating')
      .sum('matches.player_score as goalsScored')
      .sum('matches.cpu_score as goalsConceded')
      .select(db.raw('SUM(matches.player_score - matches.cpu_score) as "goalDifference"'))
      .groupBy('players.id', 'players.nickname')
      .orderBy('rating', 'desc')
      .orderBy('goalDifference', 'desc')
      .orderBy('goalsScored', 'desc')
      .orderBy('players.id', 'asc')
      .limit(Math.min(100, Math.max(1, filters.limit ?? 100)))

    if (filters.range === 'week') {
      query.where('matches.ended_at', '>=', DateTime.utc().startOf('week').toSQL())
    }
    if (filters.difficulty) query.where('matches.difficulty', filters.difficulty)
    if (filters.cleanSheet) query.where('matches.clean_sheet', true)

    const rows = await query
    return rows.map((row) => ({
      playerId: Number(row.playerId),
      nickname: String(row.nickname),
      gamesPlayed: Number(row.gamesPlayed),
      rating: Number(row.rating),
      goalsScored: Number(row.goalsScored),
      goalsConceded: Number(row.goalsConceded),
      goalDifference: Number(row.goalDifference),
    }))
  }

  // ---- Save profile --------------------------------------------------

  /** Recover one account identity and merge any guest history into it. */
  async claimProfile(user: User, token?: string) {
    return db.transaction(async (trx) => {
      await User.query({ client: trx }).where('id', user.id).forUpdate().firstOrFail()
      const session = token
        ? await KanterBallGuestSession.query({ client: trx })
            .where('token', token)
            .where('expires_at', '>', DateTime.utc().toSQL())
            .first()
        : null
      const guest = session
        ? await KanterBallPlayer.query({ client: trx })
            .where('id', session.kanterPlayerId)
            .forUpdate()
            .firstOrFail()
        : null
      if (guest?.userId && guest.userId !== user.id) {
        throw new Exception('This guest profile is already linked to another account', {
          status: 422,
        })
      }
      const existing = await KanterBallPlayer.query({ client: trx })
        .where('user_id', user.id)
        .orderBy('id')
        .forUpdate()
      const player = existing[0] ?? guest
      if (!player) throw new Exception('No saved Kanter profile found', { status: 404 })
      const sources = [
        ...new Set([...existing, ...(guest ? [guest] : [])].map((p) => p.id)),
      ].filter((id) => id !== player.id)
      for (const id of sources) {
        await trx
          .from('canter_matches')
          .where('kanter_player_id', id)
          .update({ kanter_player_id: player.id })
        await trx
          .from('kanter_ball_guest_sessions')
          .where('kanter_player_id', id)
          .update({ kanter_player_id: player.id })
        await trx.from('kanter_ball_players').where('id', id).delete()
      }
      player.useTransaction(trx)
      player.userId = user.id
      await player.save()
      const renewed = await KanterBallGuestSession.create(
        {
          kanterPlayerId: player.id,
          token: this.generateToken(),
          expiresAt: DateTime.utc().plus({ days: GUEST_SESSION_TTL_DAYS }),
        },
        { client: trx }
      )
      return {
        playerId: player.id,
        nickname: player.nickname,
        linked: true,
        token: renewed.token,
        expiresAt: renewed.expiresAt,
      }
    })
  }
}
