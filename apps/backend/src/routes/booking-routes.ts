import { registerBookingLifecycleRoutes } from '../modules/booking/booking.routes.js';
import { registerRecurringRoutes } from '../modules/recurring/recurring.routes.js';
import {
  createBookingRouteContext,
  type BookingRouteDeps,
} from '../modules/shared/route-context.js';
import { registerServiceRoutes } from '../modules/services/service.routes.js';
import { registerSlotRoutes } from '../modules/slots/slot.routes.js';
import { registerTicketRoutes } from '../modules/tickets/ticket.routes.js';

export const registerBookingRoutes = (deps: BookingRouteDeps) => {
  const ctx = createBookingRouteContext(deps);

  registerServiceRoutes(ctx);
  registerSlotRoutes(ctx);
  registerRecurringRoutes(ctx);
  registerBookingLifecycleRoutes(ctx);
  registerTicketRoutes(ctx);
};
