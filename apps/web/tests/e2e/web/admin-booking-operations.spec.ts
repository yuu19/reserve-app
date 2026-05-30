import { test } from '@playwright/test';
import {
	acceptInvitation,
	createAccount,
	createOwnerOrganization,
	createParticipantInvitation,
	futureSlotRange,
	signUpAccount,
	startPremiumTrial,
	syncRequestCookiesToBrowser,
	uniqueToken
} from '../helpers/test-data';
import { BookingOperationsPage } from '../pages';

test.describe('admin booking operations', () => {
	test.setTimeout(180_000);

	test('covers service creation, slot creation, approval booking, cancellation, and recurring creation', async ({
		page,
		request,
		context,
		playwright
	}, testInfo) => {
		const token = uniqueToken(testInfo, 'booking-ops');
		const approvalServiceName = `Approval service ${token}`;
		const recurringServiceName = `Recurring service ${token}`;
		const participant = createAccount(token, 'participant');
		const { organization } = await createOwnerOrganization({ request, context, token });
		await startPremiumTrial({ request, organization });
		await syncRequestCookiesToBrowser(request, context);
		const operations = new BookingOperationsPage(page);

		await operations.createServiceFromAdmin({
			organization,
			name: approvalServiceName,
			bookingPolicy: 'approval'
		});
		const slotRange = futureSlotRange(1);
		await operations.createSlotFromAdmin({
			organization,
			serviceName: approvalServiceName,
			dateInput: slotRange.dateInput,
			startTime: slotRange.startTime,
			endTime: slotRange.endTime
		});

		const participantInvitation = await createParticipantInvitation({
			request,
			organization,
			email: participant.email,
			participantName: participant.name
		});
		const participantRequest = await playwright.request.newContext();
		try {
			await signUpAccount({ request: participantRequest, account: participant });
			await acceptInvitation({ request: participantRequest, invitation: participantInvitation });
			await context.clearCookies();
			await syncRequestCookiesToBrowser(participantRequest, context);
			await operations.applyForApprovalBooking({
				organization,
				slotLabel: `${slotRange.startTime} - ${slotRange.endTime}`
			});

			await context.clearCookies();
			await syncRequestCookiesToBrowser(request, context);
			await operations.approveBookingFromAdmin({
				organization,
				participantEmail: participant.email
			});
			await operations.cancelApprovedBookingFromAdmin(participant.email);
		} finally {
			await participantRequest.dispose();
		}

		const recurringStart = futureSlotRange(2);
		const recurringEnd = futureSlotRange(16);
		await operations.createServiceFromAdmin({
			organization,
			name: recurringServiceName,
			kind: 'recurring'
		});
		await operations.createRecurringScheduleFromAdmin({
			organization,
			serviceName: recurringServiceName,
			startDate: recurringStart.dateInput,
			endDate: recurringEnd.dateInput
		});
	});
});
