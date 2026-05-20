import { registerBookingLifecycleRoutes } from '../features/booking/booking.routes.js';
import { registerRecurringRoutes } from '../features/recurring/recurring.routes.js';
import {
  createBookingRouteContext,
  type BookingRouteDeps,
} from '../features/booking/booking-route-context.js';
import { registerServiceRoutes } from '../features/services/service.routes.js';
import { registerSlotRoutes } from '../features/slots/slot.routes.js';
import { registerTicketRoutes } from '../features/tickets/ticket.routes.js';

export const registerBookingRoutes = (deps: BookingRouteDeps) => {
  const ctx = createBookingRouteContext(deps);

  registerServiceRoutes(ctx);
  registerSlotRoutes(ctx);
  registerRecurringRoutes(ctx);
  registerBookingLifecycleRoutes(ctx);
  registerTicketRoutes(ctx);
};
