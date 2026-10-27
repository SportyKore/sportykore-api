export const STAGE_TYPES = ['round_robin', 'group', 'knockout', 'playoff', 'swiss'] as const
export type StageType = (typeof STAGE_TYPES)[number]

export const STAGE_STATUSES = ['upcoming', 'active', 'completed'] as const
export type StageStatus = (typeof STAGE_STATUSES)[number]

export const BRACKET_ROUNDS = [
  'r256',
  'r128',
  'r64',
  'r32',
  'r16',
  'qf',
  'sf',
  'final',
  'third_place',
] as const
export type BracketRound = (typeof BRACKET_ROUNDS)[number]

/** Rounds that participate in nextRound progression (excludes third_place). */
export const PROGRESSION_ROUNDS = [
  'r256',
  'r128',
  'r64',
  'r32',
  'r16',
  'qf',
  'sf',
  'final',
] as const
export type ProgressionRound = (typeof PROGRESSION_ROUNDS)[number]

export const TIE_FORMATS = ['single', 'two_legged', 'best_of'] as const
export type TieFormat = (typeof TIE_FORMATS)[number]

export const TIE_STATUSES = ['pending', 'in_progress', 'completed'] as const
export type TieStatus = (typeof TIE_STATUSES)[number]

export type TieFormatConfig = {
  tie_format: TieFormat
  best_of?: number
  away_goals?: boolean
}

export type KnockoutStageConfig = {
  format: {
    starting_round?: BracketRound
    has_third_place?: boolean
  }
  ties: {
    default: TieFormatConfig
    rounds?: Partial<Record<BracketRound, TieFormatConfig>>
  }
}

export type GroupStageConfig = {
  format: { group_count: number; double_round_robin?: boolean }
  advancement: { per_group: number }
}

export const SWISS_BYE_HANDLINGS = ['warn', 'award_points', 'exclude'] as const
export type SwissByeHandling = (typeof SWISS_BYE_HANDLINGS)[number]

export const SWISS_PLAYOFF_PAIRINGS = ['rank_cross', 'seeded'] as const
export type SwissPlayoffPairing = (typeof SWISS_PLAYOFF_PAIRINGS)[number]

export type SwissQualificationRule = {
  directCount: number
  playoffRankFrom: number
  playoffRankTo: number
  playoffPairing?: SwissPlayoffPairing
}

export type SwissStageConfig = {
  format: {
    rounds: number
    byeHandling: SwissByeHandling
    /** Stored once (round 1) so the random draw is reproducible. */
    seed?: number
  }
  /** Default qualification rule, used by any group without its own override below. */
  qualification: SwissQualificationRule
  /** Per-group override — campuses can have different direct/playoff cutoffs. Keyed by stageGroupId. */
  qualificationByGroup?: Record<string, SwissQualificationRule>
  constraints?: {
    /** Pairs of teams that must never be drawn against each other. */
    noPair?: Array<{ teamIds: number[] }>
  }
}
