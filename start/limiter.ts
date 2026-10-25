/*
|--------------------------------------------------------------------------
| Define HTTP limiters
|--------------------------------------------------------------------------
|
| The "limiter.define" method creates an HTTP middleware to apply rate
| limits on a route or a group of routes. Feel free to define as many
| throttle middleware as needed.
|
*/

import limiter from '@adonisjs/limiter/services/main'
import type { HttpContext } from '@adonisjs/core/http'

// general API, applies to all routes
export const globalThrottle = limiter.define('global', (ctx: HttpContext) => {
  // authenticated users get more requests
  if (ctx.auth.user) {
    return limiter.allowRequests(500).every('1 minute').usingKey(`user_${ctx.auth.user.id}`)
  }

  // guest requests
  return limiter.allowRequests(500).every('1 minute').usingKey(`ip_${ctx.request.ip()}`)
})

// strict, for auth endpoints (login, register)
export const authThrottle = limiter.define('auth', (ctx: HttpContext) => {
  return limiter
    .allowRequests(5)
    .every('1 minute')
    .blockFor('15 mins') // block for 15 mins after 5 failed attempts
    .usingKey(`auth_${ctx.request.ip()}`)
    .limitExceeded((error: any) => {
      error
        .setStatus(429)
        .setMessage(`Too many attempts. Try again in ${error.response.availableIn} seconds`)
    })
})

// invite generation, prevent spam
export const inviteThrottle = limiter.define('invite', (ctx: HttpContext) => {
  return limiter
    .allowRequests(10)
    .every('1 hour')
    .usingKey(`invite_${ctx.auth.user!.id}`)
    .limitExceeded((error: any) => {
      error.setStatus(429).setMessage('Too many invites generated. Try again in an hour')
    })
})

// score updates, allow fast live score tapping without blocking clock or lineup actions
export const scoreUpdateThrottle = limiter.define('score_update', (ctx: HttpContext) => {
  return limiter
    .allowRequests(120)
    .every('1 minute')
    .usingKey(`score_update_${ctx.auth.user!.id}`)
    .limitExceeded((error: any) => {
      error.setStatus(429).setMessage('Slow down, too many score updates')
    })
})

// stat updates, for goal accreditation and event edits
export const statUpdateThrottle = limiter.define('stat_update', (ctx: HttpContext) => {
  return limiter
    .allowRequests(90)
    .every('1 minute')
    .usingKey(`stat_update_${ctx.auth.user!.id}`)
    .limitExceeded((error: any) => {
      error.setStatus(429).setMessage('Slow down, too many stat updates')
    })
})

// clock updates, for period transitions, pauses, and final decisions
export const clockUpdateThrottle = limiter.define('clock_update', (ctx: HttpContext) => {
  return limiter
    .allowRequests(30)
    .every('1 minute')
    .usingKey(`clock_update_${ctx.auth.user!.id}`)
    .limitExceeded((error: any) => {
      error.setStatus(429).setMessage('Slow down, too many clock updates')
    })
})

// lineup updates, prevent abuse during live games
export const gameUpdateThrottle = limiter.define('game_update', (ctx: HttpContext) => {
  return limiter
    .allowRequests(60)
    .every('1 minute')
    .usingKey(`game_update_${ctx.auth.user!.id}`)
    .limitExceeded((error: any) => {
      error.setStatus(429).setMessage('Slow down, too many lineup updates')
    })
})

// search, prevent scraping
export const searchThrottle = limiter.define('search', (ctx: HttpContext) => {
  if (ctx.auth.user) {
    return limiter.allowRequests(60).every('1 minute').usingKey(`search_${ctx.auth.user.id}`)
  }

  return limiter.allowRequests(20).every('1 minute').usingKey(`search_ip_${ctx.request.ip()}`)
})

// /secret-santa dashboard login, max 5 attempts per 15 minutes per IP
export const secretSantaLoginThrottle = limiter.define('secret_santa_login', (ctx: HttpContext) => {
  return limiter
    .allowRequests(5)
    .every('15 mins')
    .blockFor('30 mins')
    .usingKey(`secret_santa_login_${ctx.request.ip()}`)
    .limitExceeded((error: any) => {
      error.setMessage(`Too many attempts. Try again in ${error.response.availableIn} seconds`)
    })
})

// prevent OTP spam, max 15 requests per 10 minutes per email
export const otpRequestThrottle = limiter.define('otp_request', (ctx: HttpContext) => {
  const email = ctx.request.body().email ?? ctx.request.ip()
  return limiter
    .allowRequests(15)
    .every('10 mins')
    .usingKey(`otp_request_${email}`)
    .blockFor('30 mins')
    .limitExceeded((error: any) => {
      error.setMessage(`Too many OTP requests. Try again in ${error.response.availableIn} seconds`)
    })
})

// prevent brute force guessing, max 15 attempts per 10 minutes
export const otpVerifyThrottle = limiter.define('otp_verify', (ctx: HttpContext) => {
  const email = ctx.request.body().email ?? ctx.request.ip()
  return limiter
    .allowRequests(15)
    .every('10 mins')
    .usingKey(`otp_verify_${email}`)
    .blockFor('30 mins')
    .limitExceeded((error: any) => {
      error.setMessage(
        `Too many failed attempts. Try again in ${error.response.availableIn} seconds`
      )
    })
})

// canter ball match create/join/show/timeout-claim — these are the lower-frequency,
// resource-creating actions, so keep the budget tighter.
export const canterMatchThrottle = limiter.define('canter_match', (ctx: HttpContext) => {
  return limiter
    .allowRequests(40)
    .every('1 minute')
    .usingKey(`canter_match_${ctx.auth.user!.id}`)
    .limitExceeded((error: any) => {
      error.setStatus(429).setMessage('Slow down, too many match requests')
    })
})

// canter ball turn submission — self-limiting already (the 10s shot clock, plus
// out-of-turn/wrong-cap attempts are rejected server-side), so this budget is just
// a backstop against scripted abuse, not a cap on normal rapid play.
export const canterTurnThrottle = limiter.define('canter_turn', (ctx: HttpContext) => {
  return limiter
    .allowRequests(60)
    .every('1 minute')
    .usingKey(`canter_turn_${ctx.auth.user!.id}`)
    .limitExceeded((error: any) => {
      error.setStatus(429).setMessage('Slow down, too many shots')
    })
})

// Public spectator endpoints (list active matches, fetch one to watch) — no
// logged-in user to key on, so this is IP-keyed instead.
export const canterPublicThrottle = limiter.define('canter_public', (ctx: HttpContext) => {
  return limiter
    .allowRequests(60)
    .every('1 minute')
    .usingKey(`canter_public_${ctx.request.ip()}`)
    .limitExceeded((error: any) => {
      error.setStatus(429).setMessage('Slow down')
    })
})

// Kanter Ball (solo vs CPU) guest-session bootstrap — IP-keyed, no identity
// exists yet at this point.
export const kanterGuestSessionThrottle = limiter.define(
  'kanter_guest_session',
  (ctx: HttpContext) => {
    return limiter
      .allowRequests(20)
      .every('1 minute')
      .usingKey(`kanter_guest_session_${ctx.request.ip()}`)
      .limitExceeded((error: any) => {
        error.setStatus(429).setMessage('Slow down')
      })
  }
)

// Kanter Ball solo match start/finish — guest-token-keyed (there's no
// ctx.auth.user for guest play), generous enough for normal rapid replay.
export const kanterMatchThrottle = limiter.define('kanter_match', (ctx: HttpContext) => {
  const token = String(ctx.request.input('token') ?? ctx.request.ip())
  return limiter
    .allowRequests(30)
    .every('1 minute')
    .usingKey(`kanter_match_${token}`)
    .limitExceeded((error: any) => {
      error.setStatus(429).setMessage('Slow down, too many match requests')
    })
})

// Public leaderboard reads.
export const kanterLeaderboardThrottle = limiter.define(
  'kanter_leaderboard',
  (ctx: HttpContext) => {
    return limiter
      .allowRequests(60)
      .every('1 minute')
      .usingKey(`kanter_leaderboard_${ctx.request.ip()}`)
      .limitExceeded((error: any) => {
        error.setStatus(429).setMessage('Slow down')
      })
  }
)
