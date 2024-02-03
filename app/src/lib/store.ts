import { persisted } from 'svelte-persisted-store'
import { ulid } from 'ulid'
export const clientStore = persisted('codecity:client', {
  uid: ulid(),
})
