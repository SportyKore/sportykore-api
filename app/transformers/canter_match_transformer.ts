import { BaseTransformer } from '@adonisjs/core/transformers'
import type CanterMatch from '#models/canter_match'
import type User from '#models/user'

function displayName(user: User | null | undefined): string | null {
  if (!user) return null
  return user.fullName || user.email.split('@')[0] || 'Player'
}

export default class CanterMatchTransformer extends BaseTransformer<CanterMatch> {
  toObject() {
    return {
      ...this.pick(this.resource, [
        'id',
        'status',
        'rulesMode',
        'hostUserId',
        'guestUserId',
        'winnerUserId',
        'hostScore',
        'guestScore',
        'currentTurnUserId',
        'turnNumber',
        'turnExpiresAt',
        'state',
        'startedAt',
        'endedAt',
      ]),
    }
  }

  /** Only set for the match's host, right after creation — not part of the live/public shape. */
  WithInvite() {
    return {
      ...this.toObject(),
      inviteCode: this.resource.inviteCode,
      inviteExpiresAt: this.resource.inviteExpiresAt,
    }
  }

  /**
   * Public spectator shape — adds display names (full name, falling back to the
   * email's local-part — never the raw email) since anonymous viewers have no
   * other way to tell players apart. Requires hostUser/guestUser to be preloaded.
   */
  Spectator() {
    return {
      ...this.toObject(),
      hostName: displayName(this.resource.hostUser),
      guestName: displayName(this.resource.guestUser),
    }
  }
}
