/**
 * Server-authoritative port of sportykore-waitlist's Kanter Ball physics
 * engine (src/lib/kanter-ball/{physics,boundaries,scoring,owner,aim,modes}.js),
 * scoped to Street rules only — Football's throw-in/corner/goal-kick restart
 * system isn't ported here. Logic mirrors the client byte-for-byte so a
 * flick resolves identically wherever it runs; keep both in sync by hand
 * until this is extracted into a shared package.
 */

export type Vector = { x: number; y: number }

export type Body = {
  id: string
  side: 'host' | 'guest' | 'ball'
  role: 'keeper' | 'outfield' | 'ball'
  owner: boolean
  x: number
  y: number
  vx: number
  vy: number
  r: number
  mass: number
}

export const WORLD = { width: 720, height: 980 }
const PITCH = { x: 48, y: 58, width: 624, height: 864 }
const FIELD_INSET = 28
export const FIELD = insetPitch(PITCH, FIELD_INSET)
export const GOAL = { width: 186, depth: 34 }

export const STREET_PHYSICS = {
  friction: 350,
  maxDrag: 125,
  powerScale: 8.25,
  restitution: 0.82,
  wallRestitution: 0.78,
  restSpeed: 11,
  settleDelay: 0.18,
}

export const OWNER_LIMITS = {
  calmMax: 2,
  warnStart: 3,
  vexStart: 5,
  collectAt: 7,
}

export const GOAL_TARGET = 3
export const TICK_DT = 1 / 60
export const MAX_TICKS = 600

function insetPitch(pitch: typeof PITCH, inset: number) {
  return {
    x: pitch.x + inset,
    y: pitch.y + inset,
    width: pitch.width - inset * 2,
    height: pitch.height - inset * 2,
  }
}

/** Fixed kickoff layout — mirrors resetPositions() in kanter-ball.astro exactly. */
export function kickoffBodies(): Body[] {
  const ball: Body = {
    id: 'ball',
    side: 'ball',
    role: 'ball',
    owner: false,
    x: 360,
    y: 490,
    r: 14,
    mass: 0.7,
    vx: 0,
    vy: 0,
  }
  const hostCaps: Body[] = [
    {
      id: 'host-0',
      side: 'host',
      role: 'keeper',
      owner: false,
      x: 360,
      y: 865,
      r: 25,
      mass: 1.8,
      vx: 0,
      vy: 0,
    },
    {
      id: 'host-1',
      side: 'host',
      role: 'outfield',
      owner: false,
      x: 215,
      y: 770,
      r: 24,
      mass: 1.6,
      vx: 0,
      vy: 0,
    },
    {
      id: 'host-2',
      side: 'host',
      role: 'outfield',
      owner: false,
      x: 505,
      y: 770,
      r: 24,
      mass: 1.6,
      vx: 0,
      vy: 0,
    },
    {
      id: 'host-3',
      side: 'host',
      role: 'outfield',
      owner: false,
      x: 280,
      y: 675,
      r: 24,
      mass: 1.6,
      vx: 0,
      vy: 0,
    },
    {
      id: 'host-4',
      side: 'host',
      role: 'outfield',
      owner: false,
      x: 440,
      y: 675,
      r: 24,
      mass: 1.6,
      vx: 0,
      vy: 0,
    },
    {
      id: 'host-5',
      side: 'host',
      role: 'outfield',
      owner: false,
      x: 220,
      y: 585,
      r: 24,
      mass: 1.6,
      vx: 0,
      vy: 0,
    },
    {
      id: 'host-6',
      side: 'host',
      role: 'outfield',
      owner: false,
      x: 500,
      y: 585,
      r: 24,
      mass: 1.6,
      vx: 0,
      vy: 0,
    },
  ]
  const guestCaps: Body[] = [
    {
      id: 'guest-0',
      side: 'guest',
      role: 'keeper',
      owner: false,
      x: 360,
      y: 115,
      r: 25,
      mass: 1.8,
      vx: 0,
      vy: 0,
    },
    {
      id: 'guest-1',
      side: 'guest',
      role: 'outfield',
      owner: false,
      x: 215,
      y: 210,
      r: 24,
      mass: 1.6,
      vx: 0,
      vy: 0,
    },
    {
      id: 'guest-2',
      side: 'guest',
      role: 'outfield',
      owner: false,
      x: 505,
      y: 210,
      r: 24,
      mass: 1.6,
      vx: 0,
      vy: 0,
    },
    {
      id: 'guest-3',
      side: 'guest',
      role: 'outfield',
      owner: true,
      x: 280,
      y: 305,
      r: 24,
      mass: 1.6,
      vx: 0,
      vy: 0,
    },
    {
      id: 'guest-4',
      side: 'guest',
      role: 'outfield',
      owner: false,
      x: 440,
      y: 305,
      r: 24,
      mass: 1.6,
      vx: 0,
      vy: 0,
    },
    {
      id: 'guest-5',
      side: 'guest',
      role: 'outfield',
      owner: false,
      x: 220,
      y: 395,
      r: 24,
      mass: 1.6,
      vx: 0,
      vy: 0,
    },
    {
      id: 'guest-6',
      side: 'guest',
      role: 'outfield',
      owner: false,
      x: 500,
      y: 395,
      r: 24,
      mass: 1.6,
      vx: 0,
      vy: 0,
    },
  ]
  return [ball, ...hostCaps, ...guestCaps]
}

export function ownerReaction(hits: number) {
  const count = Math.max(0, Number.isFinite(hits) ? hits : 0)
  if (count >= OWNER_LIMITS.collectAt) return { stage: 'collect' as const }
  if (count >= OWNER_LIMITS.vexStart) return { stage: 'vexed' as const }
  if (count >= OWNER_LIMITS.warnStart) return { stage: 'warning' as const }
  if (count > 0) return { stage: 'alert' as const }
  return { stage: 'calm' as const }
}

export function classifyGoal({
  scoringSide,
  lastTouch,
}: {
  scoringSide: 'host' | 'guest'
  lastTouch: 'host' | 'guest' | null
}) {
  return { ownGoal: Boolean(lastTouch && lastTouch !== scoringSide) }
}

function normalizeVector(vector: Vector | null): Vector | null {
  if (!vector) return null
  const length = Math.hypot(vector.x || 0, vector.y || 0)
  if (length <= 0.001) return null
  return { x: vector.x / length, y: vector.y / length }
}

export function clampVector(vector: Vector, max: number): Vector {
  const length = Math.hypot(vector.x, vector.y)
  if (length <= max) return vector
  return { x: (vector.x / length) * max, y: (vector.y / length) * max }
}

function collisionGeometry({
  a,
  b,
  preferredNormal = null,
}: {
  a: Body
  b: Body
  preferredNormal?: Vector | null
}) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const dist = Math.hypot(dx, dy)
  const minimumDistance = a.r + b.r
  if (dist >= minimumDistance) return null

  let normal = normalizeVector(preferredNormal)
  if (!normal && dist > 0.001) normal = { x: dx / dist, y: dy / dist }
  if (!normal) {
    normal = normalizeVector({ x: a.vx - b.vx, y: a.vy - b.vy }) || { x: 1, y: 0 }
  }

  return { normal, overlap: minimumDistance - dist }
}

function shouldRecordLastTouch(relativeNormalSpeed: number) {
  return Number.isFinite(relativeNormalSpeed) && relativeNormalSpeed < -1
}

/** Predicted direction the ball travels on the flicking cap's first touch — snaps the collision normal to feel precise, mirrors analyzeAim()'s ballPath.direction. */
export function predictBallDirection({
  cap,
  drag,
  ball,
  bodies,
}: {
  cap: Body
  drag: Vector
  ball: Body
  bodies: Body[]
}): Vector | null {
  const magnitude = Math.hypot(drag.x, drag.y)
  if (magnitude < 10) return null
  const direction = { x: drag.x / magnitude, y: drag.y / magnitude }

  const targets = bodies.filter((body) => body !== cap)
  let firstDistance = Number.POSITIVE_INFINITY
  let firstIsBall = false
  for (const target of targets) {
    const distance = rayCircleEntry(cap, direction, target, cap.r + target.r)
    if (distance !== null && distance < firstDistance) {
      firstDistance = distance
      firstIsBall = target === ball
    }
  }
  if (!firstIsBall || !Number.isFinite(firstDistance)) return null

  const guideEnd = {
    x: cap.x + direction.x * firstDistance,
    y: cap.y + direction.y * firstDistance,
  }
  const impactX = ball.x - guideEnd.x
  const impactY = ball.y - guideEnd.y
  const impactMagnitude = Math.hypot(impactX, impactY)
  if (impactMagnitude <= 0) return direction
  return { x: impactX / impactMagnitude, y: impactY / impactMagnitude }
}

function rayCircleEntry(origin: Vector, direction: Vector, target: Body, radius: number) {
  const dx = target.x - origin.x
  const dy = target.y - origin.y
  const projection = dx * direction.x + dy * direction.y
  if (projection <= 0) return null
  const perpendicularSquared = dx * dx + dy * dy - projection * projection
  const radiusSquared = radius * radius
  if (perpendicularSquared > radiusSquared) return null
  return Math.max(0, projection - Math.sqrt(Math.max(0, radiusSquared - perpendicularSquared)))
}

function applyFriction(body: Body, dt: number) {
  const speed = Math.hypot(body.vx, body.vy)
  if (speed <= 0) return
  const next = Math.max(0, speed - STREET_PHYSICS.friction * dt)
  if (next < STREET_PHYSICS.restSpeed) {
    body.vx = 0
    body.vy = 0
    return
  }
  body.vx = (body.vx / speed) * next
  body.vy = (body.vy / speed) * next
}

function resolveCounterWalls(body: Body) {
  const left = FIELD.x
  const right = FIELD.x + FIELD.width
  const top = FIELD.y
  const bottom = FIELD.y + FIELD.height
  const goalOpeningLeft = FIELD.x + FIELD.width / 2 - GOAL.width / 2
  const goalOpeningRight = FIELD.x + FIELD.width / 2 + GOAL.width / 2
  const restitution = STREET_PHYSICS.wallRestitution
  const fitsGoalOpening = body.x - body.r >= goalOpeningLeft && body.x + body.r <= goalOpeningRight
  const overlapsGoalOpening =
    body.x + body.r > goalOpeningLeft && body.x - body.r < goalOpeningRight
  const insideTopPocket = body.y < top && overlapsGoalOpening
  const insideBottomPocket = body.y > bottom && overlapsGoalOpening

  if (body.x - body.r < left) {
    body.x = left + body.r
    body.vx = Math.abs(body.vx) * restitution
  }
  if (body.x + body.r > right) {
    body.x = right - body.r
    body.vx = -Math.abs(body.vx) * restitution
  }

  if (body.y - body.r < top) {
    if (fitsGoalOpening || insideTopPocket) {
      constrainGoalPocketSides(body, goalOpeningLeft, goalOpeningRight, restitution)
      const back = top - GOAL.depth
      if (body.y - body.r < back) {
        body.y = back + body.r
        body.vy = Math.abs(body.vy) * restitution
      }
    } else {
      body.y = top + body.r
      body.vy = Math.abs(body.vy) * restitution
    }
  }

  if (body.y + body.r > bottom) {
    if (fitsGoalOpening || insideBottomPocket) {
      constrainGoalPocketSides(body, goalOpeningLeft, goalOpeningRight, restitution)
      const back = bottom + GOAL.depth
      if (body.y + body.r > back) {
        body.y = back - body.r
        body.vy = -Math.abs(body.vy) * restitution
      }
    } else {
      body.y = bottom - body.r
      body.vy = -Math.abs(body.vy) * restitution
    }
  }
}

function constrainGoalPocketSides(body: Body, left: number, right: number, restitution: number) {
  if (body.x - body.r < left) {
    body.x = left + body.r
    body.vx = Math.abs(body.vx) * restitution
  }
  if (body.x + body.r > right) {
    body.x = right - body.r
    body.vx = -Math.abs(body.vx) * restitution
  }
}

function goalLeft() {
  return 360 - GOAL.width / 2
}
function goalRight() {
  return 360 + GOAL.width / 2
}

export type ShotState = {
  cap: Body
  side: 'host' | 'guest'
  touchedBall: boolean
  touchedOwner: boolean
  ownerWarned: boolean
  scored: { side: 'host' | 'guest' } | null
  predictedBallDirection: Vector | null
}

export type TurnResult = {
  frames: Array<{ ball: Vector; caps: Array<{ id: string; x: number; y: number }> }>
  resultEvent:
    | { type: 'goal'; scoringSide: 'host' | 'guest'; ownGoal: boolean }
    | { type: 'owner'; stage: 'collect' | 'vexed' | 'warning' | 'alert' }
    | { type: 'none' }
  lastTouch: 'host' | 'guest' | null
  ownerHits: number
}

/**
 * Runs one full turn to completion: applies the flick, steps physics until
 * a goal is scored or the bodies settle, and returns the frame-by-frame
 * trajectory plus the resulting event. Mutates `bodies` in place to their
 * final resting positions.
 */
export function resolveTurn({
  bodies,
  shooterSide,
  capId,
  drag,
  lastTouch,
  ownerHits,
  ownerRuleActive,
}: {
  bodies: Body[]
  shooterSide: 'host' | 'guest'
  capId: string
  drag: Vector
  lastTouch: 'host' | 'guest' | null
  ownerHits: number
  ownerRuleActive: boolean
}): TurnResult {
  const ball = bodies.find((body) => body.id === 'ball')!
  const cap = bodies.find((body) => body.id === capId)!
  const clampedDrag = clampVector(drag, STREET_PHYSICS.maxDrag)

  const shot: ShotState = {
    cap,
    side: shooterSide,
    touchedBall: false,
    touchedOwner: false,
    ownerWarned: false,
    scored: null,
    predictedBallDirection: predictBallDirection({ cap, drag: clampedDrag, ball, bodies }),
  }

  cap.vx = clampedDrag.x * STREET_PHYSICS.powerScale
  cap.vy = clampedDrag.y * STREET_PHYSICS.powerScale

  const frames: TurnResult['frames'] = []
  let currentLastTouch = lastTouch
  let settleTimer = 0

  for (let tick = 0; tick < MAX_TICKS; tick += 1) {
    for (const body of bodies) {
      body.x += body.vx * TICK_DT
      body.y += body.vy * TICK_DT
      applyFriction(body, TICK_DT)
    }
    for (const body of bodies) resolveCounterWalls(body)

    for (let i = 0; i < bodies.length; i += 1) {
      for (let j = i + 1; j < bodies.length; j += 1) {
        currentLastTouch = collideBodies(bodies[i], bodies[j], {
          ball,
          shot,
          ownerRuleActive,
          ownerHits,
          currentLastTouch,
        })
      }
    }

    frames.push({
      ball: { x: ball.x, y: ball.y },
      caps: bodies
        .filter((body) => body.id !== 'ball')
        .map((body) => ({ id: body.id, x: body.x, y: body.y })),
    })

    if (ball.x > goalLeft() && ball.x < goalRight() && ball.y + ball.r < FIELD.y) {
      shot.scored = { side: 'host' }
      break
    }
    if (ball.x > goalLeft() && ball.x < goalRight() && ball.y - ball.r > FIELD.y + FIELD.height) {
      shot.scored = { side: 'guest' }
      break
    }

    const settled = bodies.every(
      (body) => Math.hypot(body.vx, body.vy) < STREET_PHYSICS.restSpeed + 1
    )
    if (settled) {
      settleTimer += TICK_DT
      if (settleTimer >= STREET_PHYSICS.settleDelay) break
    } else {
      settleTimer = 0
    }
  }

  if (shot.scored) {
    const goal = classifyGoal({ scoringSide: shot.scored.side, lastTouch: currentLastTouch })
    const nextOwnerHits = shot.scored.side === 'host' ? 0 : ownerHits
    return {
      frames,
      resultEvent: { type: 'goal', scoringSide: shot.scored.side, ownGoal: goal.ownGoal },
      lastTouch: null,
      ownerHits: nextOwnerHits,
    }
  }

  if (ownerRuleActive && shot.side === 'host' && shot.touchedOwner && !shot.touchedBall) {
    // nextOwnerHits is always >= 1 here, so ownerReaction() can never return 'calm'.
    const nextOwnerHits = ownerHits + 1
    const reaction = ownerReaction(nextOwnerHits) as {
      stage: Exclude<ReturnType<typeof ownerReaction>['stage'], 'calm'>
    }
    return {
      frames,
      resultEvent: { type: 'owner', stage: reaction.stage },
      lastTouch: currentLastTouch,
      ownerHits: nextOwnerHits,
    }
  }

  return { frames, resultEvent: { type: 'none' }, lastTouch: currentLastTouch, ownerHits }
}

function collideBodies(
  a: Body,
  b: Body,
  {
    ball,
    shot,
    ownerRuleActive,
    ownerHits,
    currentLastTouch,
  }: {
    ball: Body
    shot: ShotState
    ownerRuleActive: boolean
    ownerHits: number
    currentLastTouch: 'host' | 'guest' | null
  }
): 'host' | 'guest' | null {
  const predictedImpact = predictedBallImpactNormal(a, b, ball, shot)
  const collision = collisionGeometry({ a, b, preferredNormal: predictedImpact })
  if (!collision) return currentLastTouch
  const { x: nx, y: ny } = collision.normal!
  const overlap = collision.overlap

  a.x -= (nx * overlap) / 2
  a.y -= (ny * overlap) / 2
  b.x += (nx * overlap) / 2
  b.y += (ny * overlap) / 2

  const rvx = b.vx - a.vx
  const rvy = b.vy - a.vy
  const speed = rvx * nx + rvy * ny
  let nextLastTouch = currentLastTouch

  if (speed < 0) {
    if (
      shot.predictedBallDirection &&
      !shot.touchedBall &&
      (a === shot.cap || b === shot.cap) &&
      a !== ball &&
      b !== ball
    ) {
      shot.predictedBallDirection = null
    }
    if (shouldRecordLastTouch(speed)) {
      if (a === ball && b.side !== 'ball') nextLastTouch = b.side
      else if (b === ball && a.side !== 'ball') nextLastTouch = a.side
    }
    const impulse = (-(1 + STREET_PHYSICS.restitution) * speed) / (1 / a.mass + 1 / b.mass)
    const ix = impulse * nx
    const iy = impulse * ny
    a.vx -= ix / a.mass
    a.vy -= iy / a.mass
    b.vx += ix / b.mass
    b.vy += iy / b.mass
  }

  if (a === ball || b === ball) shot.touchedBall = true
  if (ownerRuleActive) {
    const owner = a.owner ? a : b.owner ? b : null
    if (owner && (a === owner || b === owner)) {
      shot.touchedOwner = true
      if (shot.side === 'host' && ownerHits >= OWNER_LIMITS.vexStart - 1 && !shot.ownerWarned) {
        const cap = shot.cap
        const away = normalizeVector({ x: cap.x - owner.x, y: cap.y - owner.y }) || { x: 0, y: -1 }
        cap.vx += away.x * 420
        cap.vy += away.y * 420
        shot.ownerWarned = true
      }
    }
  }

  return nextLastTouch
}

function predictedBallImpactNormal(a: Body, b: Body, ball: Body, shot: ShotState): Vector | null {
  if (!shot.predictedBallDirection || shot.touchedBall) return null
  if (a === shot.cap && b === ball) return shot.predictedBallDirection
  if (a === ball && b === shot.cap) {
    return { x: -shot.predictedBallDirection.x, y: -shot.predictedBallDirection.y }
  }
  return null
}
