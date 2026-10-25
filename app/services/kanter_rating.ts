/**
 * Kanter Ball solo-match rating formula. Pure and server-only — the client
 * never computes or sends a rating, only the raw match facts this reads.
 *
 * Versioned so the formula can change later without silently reinterpreting
 * historical matches: each match stores the formula version it was rated
 * under (`rating_formula_version`), and old rows keep their original score.
 */

export const RATING_FORMULA_VERSION = 1

export type MatchResult = 'win' | 'draw' | 'loss' | 'owner_collect'
export type Difficulty = 'easy' | 'medium' | 'hard'

const BASE_RESULT_POINTS: Record<Exclude<MatchResult, 'owner_collect'>, number> = {
  win: 1000,
  draw: 250,
  loss: 50,
}

const DIFFICULTY_MULTIPLIER: Record<Difficulty, number> = {
  easy: 1,
  medium: 1.35,
  hard: 1.75,
}

const GOAL_DIFFERENCE_POINTS = 120
const SECONDS_LEFT_POINTS = 8
const CLEAN_SHEET_BONUS = 300
const COMEBACK_BONUS = 400
const CLUTCH_GOAL_BONUS = 250
const OWNER_HIT_PENALTY = 90

// Flicks beyond this many in a single match earn no extra penalty for the
// first N, then cost a little each — discourages farming rating with
// pointless repositioning spam without punishing a normal, scrappy match.
const EXCESS_FLICK_THRESHOLD = 30
const EXCESS_FLICK_PENALTY = 5
const EXCESS_FLICK_PENALTY_CAP = 150

export interface RatingInput {
  result: MatchResult
  difficulty: Difficulty
  playerScore: number
  cpuScore: number
  /** Total length of the match format in seconds (e.g. 120 for both current rules modes). */
  matchSeconds: number
  durationSeconds: number
  flicks: number
  ownerHits: number
  cleanSheet: boolean
  comeback: boolean
  clutchGoal: boolean
}

export interface RatingBreakdown {
  rating: number
  formulaVersion: number
  baseResultPoints: number
  goalDifferenceBonus: number
  timeBonus: number
  cleanSheetBonus: number
  comebackBonus: number
  clutchBonus: number
  ownerHitPenalty: number
  excessFlickPenalty: number
  difficultyMultiplier: number
}

/**
 * `owner_collect` matches are intentionally outside the rating system (no
 * leaderboard entry — "chaos is the fun", per the casual-mode design) and
 * should never reach this function. Callers branch on `result` first.
 */
export function calculateRating(input: RatingInput): RatingBreakdown {
  const isWin = input.result === 'win'

  const baseResultPoints = BASE_RESULT_POINTS[input.result as Exclude<MatchResult, 'owner_collect'>]
  const goalDifferenceBonus =
    Math.max(0, input.playerScore - input.cpuScore) * GOAL_DIFFERENCE_POINTS

  // Only a win is rewarded for pace — finishing fast in a draw/loss isn't
  // an achievement.
  const secondsLeft = isWin ? Math.max(0, input.matchSeconds - input.durationSeconds) : 0
  const timeBonus = Math.round(secondsLeft * SECONDS_LEFT_POINTS)

  // Lightly validated against the score line itself (full validation needs
  // a server-side replay, deferred past MVP — see canter_rating docs).
  const cleanSheetBonus = input.cleanSheet && input.cpuScore === 0 ? CLEAN_SHEET_BONUS : 0
  const comebackBonus = input.comeback && isWin ? COMEBACK_BONUS : 0
  const clutchBonus = input.clutchGoal && isWin ? CLUTCH_GOAL_BONUS : 0

  const ownerHitPenalty = Math.max(0, input.ownerHits) * OWNER_HIT_PENALTY

  const excessFlicks = Math.max(0, input.flicks - EXCESS_FLICK_THRESHOLD)
  const excessFlickPenalty = Math.min(EXCESS_FLICK_PENALTY_CAP, excessFlicks * EXCESS_FLICK_PENALTY)

  const difficultyMultiplier = DIFFICULTY_MULTIPLIER[input.difficulty]

  const scaled =
    (baseResultPoints +
      goalDifferenceBonus +
      timeBonus +
      cleanSheetBonus +
      comebackBonus +
      clutchBonus) *
    difficultyMultiplier

  const rating = Math.max(0, Math.round(scaled - ownerHitPenalty - excessFlickPenalty))

  return {
    rating,
    formulaVersion: RATING_FORMULA_VERSION,
    baseResultPoints,
    goalDifferenceBonus,
    timeBonus,
    cleanSheetBonus,
    comebackBonus,
    clutchBonus,
    ownerHitPenalty,
    excessFlickPenalty,
    difficultyMultiplier,
  }
}
