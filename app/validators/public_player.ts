import vine from '@vinejs/vine'
import { resourceId, optionalImage } from '#validators/common'

export const publicPlayerValidator = vine.create({
  name: vine.string().trim().minLength(1).maxLength(255),
  countryId: resourceId('countries'),
  photo: optionalImage(),
  requestId: vine.string().uuid(),
  confirmDuplicate: vine.boolean().optional(),
})
