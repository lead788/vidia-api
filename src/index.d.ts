export declare const DEFAULT_BASE_URL: 'https://vidia.kr';

export type RunState = 'QUEUED' | 'RUNNING' | 'PAUSED' | 'AWAITING_APPROVAL' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export declare const RUN_STATES: readonly RunState[];
export declare const FINISHED_STATES: readonly RunState[];
export declare const ACTION_STATES: readonly RunState[];

export declare function redact(value: unknown, apiKey?: string): string;

export interface VidiaClientOptions {
	/** VIDIA API key (vd_live_…). Defaults to process.env.VIDIA_API_KEY. */
	apiKey?: string;
	/** Defaults to https://vidia.kr. HTTPS only; http is allowed for localhost. */
	baseUrl?: string;
	/** Overrides every request timeout (ms). */
	timeoutMs?: number;
	fetch?: typeof fetch;
}

export declare class VidiaApiError extends Error {
	name: 'VidiaApiError';
	status: number;
	code: string;
	details?: unknown;
	requestId?: string;
	toJSON(): { name: string; message: string; status: number; code: string; details?: unknown; requestId?: string };
}

export interface Account {
	user: { id: number; nickname: string | null };
	balance: { available: number; held: number; currency: 'P' };
	coupons: number;
	plan: { key: string; concurrentRuns: number | null; maxWaiting: number | null } | null;
}

export interface PackageEstimate {
	point: { expected: number; low: number; high: number };
	minutes: { expected: number; low: number; high: number };
	computedAt: string | null;
}

export interface PackageCard {
	slug: string;
	title: string;
	summary: string;
	format: 'shorts' | 'longform' | 'any' | string;
	formatLabel: string;
	visualMix: string | null;
	tags: string[];
	official: boolean;
	owner: string | null;
	estimate: PackageEstimate | null;
	url: string;
}

export interface InputField {
	key: string;
	label: string;
	type: 'text' | 'longtext' | 'number' | 'select' | 'boolean' | 'url' | 'asset' | string;
	required: boolean;
	help?: string;
	placeholder?: string;
	options?: string[];
	min?: number;
	max?: number;
	maxLength?: number;
	pattern?: string;
	accept?: string;
	multiple?: boolean;
	default?: unknown;
	oneOfGroup?: string;
	showWhen?: { key: string; values: string[] };
}

export interface PackageDetail extends PackageCard {
	description: string;
	version: number | null;
	inputs: InputField[];
	setupReady: boolean;
	setupMissing?: string[];
}

export interface ListPackagesQuery {
	q?: string;
	format?: 'shorts' | 'longform';
	mix?: 'ai-video' | 'mixed' | 'ai-image';
	tag?: string;
	sort?: 'popular' | 'recent' | 'completed';
	limit?: number;
	offset?: number;
}

export interface RunSettings {
	title?: string;
	mode?: 'AUTO' | 'MANUAL';
	problemPolicy?: 'SKIP' | 'ASK';
	loopPolicy?: 'ACCEPT' | 'ASK';
	loopRetries?: number;
	scheduledAt?: string;
}

export interface QuoteParams extends RunSettings {
	package: string;
	input: Record<string, unknown>;
}

export interface Quote {
	id: string;
	expiresAt: string | null;
	point: { minimum: number; recommended: number; expected: number; estimatedMin: number; estimatedMax: number; budgetMax: number | null };
	balance: number;
	/** Expected production time in minutes, when available. */
	minutes: { expected: number | null; low?: number | null; high?: number | null } | null;
	fees: { base: { min: number | null; max: number | null } | null; module: { min: number | null; max: number | null } | null };
	/** Present when the package sends requests to outside services; start with externalConsent: true. */
	external: { hosts: string[]; expectedCalls: number | null; maxCalls: number | null; consentRequired: true } | null;
	notice: string | null;
	next: string;
}

export interface StartRunParams extends QuoteParams {
	/** The quote id from quote(). Or pass `quote`. */
	quoteId?: string;
	/** The quote object; quoteId and (if budget is omitted) the recommended budget are taken from it. */
	quote?: Quote;
	/** Budget in points (>= quote.point.minimum). */
	budget?: number;
	/** Reuse the same key when retrying a request whose response was lost. Generated when omitted. */
	idempotencyKey?: string;
	/** Must be true: the user has agreed to the quote. */
	confirm: true;
	useCoupon?: boolean;
	/** The user agreed to the external requests listed in quote.external (only for packages that call outside services). */
	externalConsent?: boolean;
}

export interface StartedRun {
	id: number;
	state: RunState;
	scheduledAt: string | null;
	webUrl: string;
	idempotencyKey: string;
}

export interface Run {
	id: number;
	title: string | null;
	state: RunState;
	stateLabel: string;
	outcome: string | null;
	budget: number | null;
	spent: number | null;
	createdAt: string | null;
	scheduledAt: string | null;
	completedAt: string | null;
	hasVideo: boolean;
	trashed: boolean;
	error: { code: string; message: string } | null;
	reason: string | null;
	actionNeeded: string | null;
	webUrl: string;
	progress?: { step: number | null; total: number };
	eta?: { seconds: number | null; low: number | null; high: number | null; finishAt: string | null; overdue: boolean } | null;
	cancelRequested?: boolean;
}

export interface Page<T> { total: number; limit: number; offset: number; items: T[] }

export interface RunFile {
	id: number | 'final';
	kind: 'video' | 'image' | 'audio' | 'subtitle' | string;
	role: 'final_video' | 'thumbnail' | 'file';
	label: string;
	name: string;
	mime?: string | null;
	bytes?: number | null;
	durationSec?: number | null;
	width?: number | null;
	height?: number | null;
	url: string;
	expiresAt: string;
}

export interface RunFiles {
	runId: number;
	state: RunState;
	ttlSeconds: number;
	items: RunFile[];
	publish: Record<string, unknown> | null;
	note?: string;
}

export interface WaitOptions {
	/** Poll interval, default 30000, minimum 5000. */
	intervalMs?: number;
	/** Give up after this many ms (default 6 hours). */
	timeoutMs?: number;
	signal?: AbortSignal;
	onProgress?: (run: Run) => void;
}

export declare class VidiaClient {
	constructor(apiKeyOrOptions?: string | VidiaClientOptions);
	readonly baseUrl: string;
	me(): Promise<Account>;
	listPackages(query?: ListPackagesQuery): Promise<Page<PackageCard>>;
	getPackage(slug: string): Promise<PackageDetail>;
	quote(params: QuoteParams): Promise<Quote>;
	startRun(params: StartRunParams): Promise<StartedRun>;
	getRun(id: number | string): Promise<Run>;
	listRuns(query?: { state?: RunState; limit?: number; offset?: number }): Promise<Page<Run>>;
	cancelRun(id: number | string, options?: { confirmed?: boolean }): Promise<Run>;
	listFiles(id: number | string): Promise<RunFiles>;
	waitForRun(id: number | string, options?: WaitOptions): Promise<Run>;
	download(file: RunFile | string, destPath: string): Promise<{ path: string; bytes: number }>;
	downloadVideo(id: number | string, destPath: string): Promise<{ path: string; bytes: number }>;
	toJSON(): { baseUrl: string };
}

export default VidiaClient;
