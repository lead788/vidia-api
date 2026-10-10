export declare const DEFAULT_BASE_URL: 'https://vidia.kr';

export type RunState = 'QUEUED' | 'RUNNING' | 'PAUSED' | 'AWAITING_APPROVAL' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export declare const RUN_STATES: readonly RunState[];
export declare const FINISHED_STATES: readonly RunState[];
export declare const ACTION_STATES: readonly RunState[];

export type RunAction = 'add_budget' | 'approve_price' | 'retry' | 'resume' | 'finish' | 'pause' | 'set_mode' | 'resend_external' | 'cancel' | 'skip' | 'more' | 'continue' | 'choose' | 'partial' | 'start' | 'acknowledge';
export declare const RUN_ACTIONS: readonly RunAction[];
export type TestScenario = 'complete' | 'fail' | 'budget' | 'review';
export declare const TEST_SCENARIOS: readonly TestScenario[];
export type WebhookEvent = 'run.completed' | 'run.failed' | 'run.cancelled' | 'run.action_required';
export declare const WEBHOOK_EVENTS: readonly WebhookEvent[];

export declare function redact(value: unknown, apiKey?: string): string;
/** Check a webhook's Vidia-Signature header against the raw request body. */
export declare function verifyWebhookSignature(secret: string, header: string | null | undefined, body: string | Uint8Array, options?: { toleranceSec?: number; now?: number }): boolean;

export interface VidiaClientOptions {
	/** VIDIA API key (vd_live_… or a test key vd_test_…). Defaults to process.env.VIDIA_API_KEY. */
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
	/** The key in use. mode 'test' means runs are simulated and cost nothing. */
	key?: { mode: 'live' | 'test'; scope: 'read' | 'run'; dailyRunLimit: number | null; maxRunBudget: number | null; dailyBudgetLimit: number | null } | null;
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
	/** Rights notice to show the user; confirm: true means they agreed to it. */
	rights?: { title: string; items: string[]; consent: string };
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
	/** Allowed live-price drift as % of the budget (default 10). */
	priceTolerance?: 0 | 5 | 10 | 20 | 30;
	autoResolve?: boolean;
	/** Test keys only: which flow to simulate. */
	testScenario?: TestScenario;
}

export interface StartedRun {
	id: number;
	state: RunState;
	scheduledAt: string | null;
	webUrl: string | null;
	idempotencyKey: string;
	/** true for simulated runs started with a test key. */
	test?: boolean;
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
	webUrl: string | null;
	/** true for simulated runs started with a test key. */
	test?: boolean;
	/** Actions you can send now with runAction(). */
	actions?: RunAction[];
	/** Why the run stopped, when it did. */
	pending?: RunPending | null;
	/** Present when getRun was called with { wait }. */
	waited?: number;
	timedOut?: boolean;
	progress?: { step: number | null; total: number };
	eta?: { seconds: number | null; low: number | null; high: number | null; finishAt: string | null; overdue: boolean } | null;
	cancelRequested?: boolean;
}

export interface RunPending {
	kind: string;
	message: string;
	autoResume: boolean;
	budget?: { total: number | null; spent: number | null; available: number | null };
	fullRefundOnCancel?: boolean;
	candidates?: { step_id: number; score: number | null; pass: boolean }[];
	priceApprovals?: { approval_id: number; point: number | null; expiresAt: string | null }[];
	chargeUrl?: string;
}

export interface RunActionParams {
	/** add_budget: points to add. */
	add?: number;
	idempotencyKey?: string;
	/** Required (true) for add_budget, approve_price and resend_external. */
	confirm?: boolean;
	approvalId?: number;
	headroomPct?: number;
	/** choose: a step_id from pending.candidates. */
	stepId?: number;
	rounds?: number;
	mode?: 'AUTO' | 'MANUAL';
}

export interface UploadKit {
	title: string;
	titles: string[];
	description: string;
	tags: string[];
	hashtags: string[];
	thumbnailTexts: string[];
	chapters: { startSec: number; title: string }[];
	pinnedComment: string | null;
	verdict: { level: 'pass' | 'warn' | 'fix'; label: string; items: { level: string; message: string }[] } | null;
	rights: { title: string; lead: string; points: string[]; closing: string } | null;
}

export type BatchItem<K extends string, T> = ({ index: number; ok: true } & Record<K, T>) | { index: number; ok: false; status: number; error: { code: string; message: string } };

export interface Usage {
	storage: { usedBytes: number | null; limitBytes: number | null; percent: number | null };
	runs: { running: number | null; waiting: number | null; scheduled: number | null; concurrentLimit: number | null };
	system: { level: string; label: string; waitMinutes: number | null } | null;
	key: { mode: 'live' | 'test'; scope: 'read' | 'run'; dailyRunLimit: number | null; runsLast24h: number | null; runsLeft: number | null; maxRunBudget: number | null; dailyBudgetLimit: number | null } | null;
}

export interface Webhook {
	id: number;
	url: string;
	events: WebhookEvent[];
	status: 'active' | 'disabled';
	disabledReason: string | null;
	secretHint: string;
	lastSuccessAt: string | null;
	lastFailureAt: string | null;
	createdAt: string | null;
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
	/** YouTube upload kit: title candidates, description, tags, chapters, pinned comment and an upload verdict. */
	upload?: UploadKit | null;
	test?: boolean;
	note?: string;
}

export interface Asset {
	id: number;
	kind: 'image' | 'video' | 'audio' | string;
	name: string | null;
	bytes: number | null;
	width: number | null;
	height: number | null;
	durationSec: number | null;
	createdAt: string | null;
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
	/** options.wait (1-50 s): the server waits until the run finishes or stops before answering. */
	getRun(id: number | string, options?: { wait?: number }): Promise<Run>;
	/** Send one of run.actions to a stopped run. */
	runAction(id: number | string, action: RunAction, params?: RunActionParams): Promise<Run>;
	batchQuotes(items: QuoteParams[]): Promise<{ total: number; ok: number; failed: number; items: BatchItem<'quote', Quote>[] }>;
	batchStart(items: Omit<StartRunParams, 'confirm'>[], options: { confirm: true }): Promise<{ total: number; started: number; failed: number; items: BatchItem<'run', StartedRun>[] }>;
	getRunInput(id: number | string): Promise<{ runId: number; package: string | null; input: Record<string, unknown> }>;
	trashRun(id: number | string): Promise<{ id: number; trashed: boolean; note?: string }>;
	restoreRun(id: number | string): Promise<{ id: number; trashed: boolean }>;
	setThumbnail(id: number | string, options: { assetId: number } | { reset: true }): Promise<{ runId: number; thumbnail: 'custom' | 'original'; assetId?: number }>;
	setShowcase(id: number | string, options: { on: true; confirm: true } | { on: false }): Promise<{ runId: number; showcase: boolean; rewardPoint: number; rewardAlready: boolean; reclaimedPoint: number }>;
	usage(): Promise<Usage>;
	pointHistory(query?: { days?: 7 | 30 | 90; limit?: number; page?: number }): Promise<{ total: number | null; page: number | null; limit: number | null; items: { id: number; type: string; delta: number | null; balanceAfter: number | null; memo: string | null; at: string | null }[] }>;
	topicIdea(slug: string, options?: { skipId?: number }): Promise<{ eligible: boolean; idea: { id: number; topic: string; reason: string } | null; preparing: boolean }>;
	packageResults(slug: string, query?: { limit?: number; offset?: number }): Promise<{ total: number | null; next: number | null; items: { title: string; by: string; publishedAt: string | null; aspect: string | null; workMinutes: number | null; thumbnailUrl: string | null; videoUrl: string | null }[] }>;
	listWebhooks(): Promise<{ items: Webhook[]; events: WebhookEvent[]; max: number }>;
	/** The secret in the response is shown only once. */
	createWebhook(params: { url: string; events?: WebhookEvent[] }): Promise<{ webhook: Webhook; secret: string; note: string }>;
	deleteWebhook(id: number): Promise<{ deleted: boolean; id: number }>;
	enableWebhook(id: number): Promise<{ webhook: Webhook }>;
	testWebhook(id: number): Promise<{ delivered: boolean; httpStatus: number | null; error: string | null; deliveryId: number }>;
	listWebhookDeliveries(id: number, query?: { limit?: number }): Promise<{ items: { id: number; event: string; runId: number | null; state: string; attempts: number; httpStatus: number | null; error: string | null; createdAt: string | null; sentAt: string | null; nextAttemptAt: string | null }[] }>;
	renameAsset(id: number, name: string): Promise<Asset>;
	deleteAsset(id: number, options: { confirm: true }): Promise<{ deleted: boolean; id: number }>;
	createUploadLink(): Promise<{ uploadUrl: string; method: 'POST'; field: 'file'; expiresAt: string; maxBytes: number; example: string; note: string }>;
	listRuns(query?: { state?: RunState; package?: string; createdFrom?: string; createdTo?: string; trashed?: boolean; limit?: number; offset?: number }): Promise<Page<Run>>;
	cancelRun(id: number | string, options?: { confirmed?: boolean }): Promise<Run>;
	listFiles(id: number | string): Promise<RunFiles>;
	listAssets(query?: { kind?: 'image' | 'video' | 'audio'; q?: string; limit?: number }): Promise<{ items: Asset[] }>;
	/** Upload a file to your library (run key). Use the returned id in asset input fields. */
	uploadAsset(filePath: string, options?: { label?: string }): Promise<Asset>;
	waitForRun(id: number | string, options?: WaitOptions): Promise<Run>;
	download(file: RunFile | string, destPath: string): Promise<{ path: string; bytes: number }>;
	downloadVideo(id: number | string, destPath: string): Promise<{ path: string; bytes: number }>;
	toJSON(): { baseUrl: string };
}

export default VidiaClient;
