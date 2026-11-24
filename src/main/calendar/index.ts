/**
 * Calendar concern — library-usable implementation behind the
 * `m365_calendar_*` tools.
 */
export { AvailabilityInputSchema, AvailabilityResultSchema, handleGetAvailability } from './availability.js'
export { handleCreateEvent } from './create.js'
export { handleDeleteEvent } from './delete.js'
export { handleListEvents } from './list.js'
