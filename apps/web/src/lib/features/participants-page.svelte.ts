import { getParticipantsPageData } from '$lib/remote/participants-page.remote';

export const loadParticipantsPageData = async () => {
	return getParticipantsPageData();
};
