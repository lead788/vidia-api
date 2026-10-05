import sdk from './index.cjs';

export const {
	VidiaClient,
	VidiaApiError,
	DEFAULT_BASE_URL,
	RUN_STATES,
	FINISHED_STATES,
	ACTION_STATES,
	redact
} = sdk;

export default VidiaClient;
