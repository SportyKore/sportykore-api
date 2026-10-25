export function validateFinish(
  input: {
    result: string
    endedReason: string
    playerScore: number
    cpuScore: number
    durationSeconds: number
    flicks: number
    ownerHits: number
    cleanSheet: boolean
    comeback: boolean
    clutchGoal: boolean
  },
  elapsed: number
): string | null {
  const { playerScore: p, cpuScore: c, durationSeconds: d, endedReason: reason, result } = input
  if (
    ![p, c, input.flicks, input.ownerHits].every(Number.isInteger) ||
    p < 0 ||
    c < 0 ||
    p > 3 ||
    c > 3 ||
    (p === 3 && c === 3)
  )
    return 'Invalid match statistics'
  if (!Number.isFinite(d) || d < 0 || d > 120 || d > elapsed + 2) return 'Invalid match duration'
  if ((reason === 'owner_collect') !== (result === 'owner_collect'))
    return 'Inconsistent owner collection result'
  if (result !== 'owner_collect' && result !== (p > c ? 'win' : p < c ? 'loss' : 'draw'))
    return 'Result does not match the score'
  if (reason === 'full_time' && Math.max(p, c) < 3 && d < 119.5) return 'The match has not finished'
  if (reason === 'full_time' && d < Math.max(p, c) * 3)
    return 'Score is not possible in the reported duration'
  if (input.cleanSheet && c !== 0) return 'A clean sheet requires zero CPU goals'
  if (input.comeback && (result !== 'win' || c < 2)) return 'Invalid comeback'
  if (input.clutchGoal && (result !== 'win' || d < 110)) return 'Invalid clutch goal'
  return null
}
