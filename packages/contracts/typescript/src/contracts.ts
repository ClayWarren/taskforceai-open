import { z } from 'zod';

/**
 * Shared API schemas + inferred TypeScript types.
 * These mirror the OpenAPI spec and allow runtime validation in every client.
 */

export const sourceReferenceSchema = z.object({
  title: z.string().optional(),
  url: z.string(),
  snippet: z.string().optional(),
});

export const generatedFileArtifactSchema = z
  .object({
    artifactId: z.string().optional(),
    filename: z.string(),
    filepath: z.string().optional(),
    mimeType: z.string().optional(),
    bytes: z.number().optional(),
    fileId: z.string().optional(),
    downloadUrl: z.string().optional(),
  })
  .passthrough();

export const toolUsageEventSchema = z
  .object({
    invocationId: z.string().optional(),
    timestamp: z.string().optional(),
    agentId: z.number().optional(),
    agentLabel: z.string(),
    toolName: z.string(),
    arguments: z.unknown(),
    success: z.boolean(),
    durationMs: z.number(),
    resultPreview: z.string().optional(),
    error: z.string().optional(),
    sources: z.array(sourceReferenceSchema).optional(),
    generatedFile: generatedFileArtifactSchema.optional(),
  })
  .passthrough();

export const agentStatusSchema = z
  .object({
    status: z.string(),
    agent_id: z.number().optional(),
    progress: z.number().optional(),
    result: z.string().optional(),
    reasoning: z.string().optional(),
    model: z.string().optional(),
  })
  .passthrough();

const baseAuthenticatedUserResponseSchema = z.object({
  $schema: z.string().url().optional(),
  cancel_at_period_end: z.boolean(),
  code_execution_enabled: z.boolean(),
  current_period_end: z.union([z.string(), z.null()]),
  current_period_start: z.union([z.string(), z.null()]),
  customer_id: z.union([z.string(), z.null()]),
  disabled: z.string(),
  email: z.string(),
  free_tasks_remaining: z.number().int().default(0),
  full_name: z.union([z.string(), z.null()]).optional(),
  id: z.number().int(),
  image: z.union([z.string(), z.null()]).optional(),
  impersonator_id: z.string().optional(),
  is_admin: z.boolean(),
  last_message_timestamp: z.union([z.string(), z.null()]),
  memory_enabled: z.boolean(),
  message_count: z.number().int(),
  mfa_enabled: z.boolean().default(false),
  notifications_enabled: z.boolean(),
  plan: z.string(),
  quick_mode_enabled: z.boolean(),
  subscription_id: z.union([z.string(), z.null()]),
  subscription_source: z.union([z.string(), z.null()]),
  subscription_status: z.union([z.string(), z.null()]),
  theme_preference: z.string(),
  trust_layer_enabled: z.boolean(),
  trial_ends_at: z.union([z.string(), z.null()]).default(null),
  web_search_enabled: z.boolean(),
});

const baseRunRequestSchema = z.object({
  $schema: z.string().url().optional(),
  attachment_ids: z.union([z.array(z.string()), z.null()]).optional(),
  budget: z.number().optional(),
  conversation_id: z.string().optional(),
  demo: z.boolean().optional(),
  modelId: z.string().optional(),
  reasoningEffort: z.string().optional(),
  options: z.object({}).partial().passthrough().optional(),
  private_chat: z.boolean().optional(),
  projectId: z.number().int().optional(),
  prompt: z.string(),
  role_models: z.record(z.string(), z.string()).optional(),
});

const taskMcpToolSummarySchema = z.object({
  server_name: z.string(),
  title: z.string().optional(),
  tool_name: z.string(),
});

const baseTaskApprovalSummarySchema = z.object({
  approval_id: z.string().optional(),
  agent_name: z.string(),
  metadata: z.object({}).partial().passthrough(),
  patterns: z.union([z.array(z.string()), z.null()]),
  permission: z.string(),
});

const baseTaskSummarySchema = z.object({
  budget_usage: z.unknown().optional(),
  client_mcp_tools: z.union([z.array(taskMcpToolSummarySchema), z.null()]).optional(),
  computer_use: z.boolean(),
  conversation_id: z.number().int().optional(),
  model_id: z.string().optional(),
  pending_approval: baseTaskApprovalSummarySchema.optional(),
  prompt: z.string().optional(),
  source: z.string().optional(),
  status: z.string(),
  task_id: z.string(),
  trace_id: z.string().optional(),
  updated_at: z.number().int().optional(),
});

export const themeSchema = z.union([z.enum(['dark', 'light']), z.literal('system')]);
export type Theme = z.infer<typeof themeSchema>;

export const planSchema = z.union([z.enum(['free', 'pro', 'super']), z.literal('admin')]);
export type Plan = z.infer<typeof planSchema>;

export const subscriptionSourceSchema = z.string().nullable();
export type SubscriptionSource = z.infer<typeof subscriptionSourceSchema>;

export const disabledSchema = z.enum(['true', 'false']);
export type Disabled = z.infer<typeof disabledSchema>;

function normalizeUnixTimestamp(value: number): number {
  const normalizedValue = Math.trunc(value);
  // Accept both Unix seconds and milliseconds from mixed backend/client payloads.
  // Values at or above 1e12 are interpreted as milliseconds.
  if (Math.abs(normalizedValue) >= 1_000_000_000_000) {
    return Math.trunc(normalizedValue / 1000);
  }
  return normalizedValue;
}

function timestampToUnixSeconds(value: number | string | Date): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return normalizeUnixTimestamp(value);
  }
  if (typeof value === 'number') {
    throw new Error('Invalid billing timestamp');
  }

  if (value instanceof Date) {
    return Math.trunc(value.getTime() / 1000);
  }

  const trimmedValue = value.trim();
  const fromNumericString = Number(trimmedValue);
  if (Number.isFinite(fromNumericString) && trimmedValue !== '') {
    return normalizeUnixTimestamp(fromNumericString);
  }

  const fromDateString = Date.parse(trimmedValue);
  if (Number.isNaN(fromDateString)) {
    throw new Error('Invalid billing timestamp');
  }

  return Math.trunc(fromDateString / 1000);
}

const billingTimestampSchema = z
  .union([z.number(), z.string(), z.date()])
  .transform((value) => timestampToUnixSeconds(value));

const authenticatedUserPeriodSchema = z
  .union([z.string(), z.number(), z.null()])
  .transform((value) => {
    if (value === null || typeof value === 'string') {
      return value;
    }
    return new Date(normalizeUnixTimestamp(value) * 1000).toISOString();
  });

export const authTokenSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
});
export type AuthToken = z.infer<typeof authTokenSchema>;

export const authenticatedUserSchema = baseAuthenticatedUserResponseSchema.extend({
  current_period_end: authenticatedUserPeriodSchema,
  current_period_start: authenticatedUserPeriodSchema,
  plan: planSchema,
  subscription_source: subscriptionSourceSchema,
  theme_preference: themeSchema,
  disabled: disabledSchema,
  is_admin: z.boolean(),
});
export type AuthenticatedUser = z.infer<typeof authenticatedUserSchema>;

export const mfaStatusResponseSchema = z.object({
  authenticator_app_enabled: z.boolean(),
});
export type MFAStatusResponse = z.infer<typeof mfaStatusResponseSchema>;

export const mfaSetupResponseSchema = mfaStatusResponseSchema.extend({
  secret: z.string(),
  otpauth_uri: z.string(),
});
export type MFASetupResponse = z.infer<typeof mfaSetupResponseSchema>;

export const mfaLoginResponseSchema = z.object({
  success: z.boolean(),
  redirect_url: z.string().optional(),
  access_token: z.string().optional(),
  token_type: z.string().optional(),
  expires_in: z.number().int().optional(),
});
export type MFALoginResponse = z.infer<typeof mfaLoginResponseSchema>;

export const runRequestSchema = baseRunRequestSchema
  .extend({
    prompt: z.string().min(1, 'Prompt is required'),
    demo: z.boolean().optional(),
    conversation_id: z.string().optional(),
    projectId: z.number().int().optional(),
    modelId: z.string().min(1, 'Model identifier is required').optional(),
    budget: z.number().optional(),
    role_models: z.record(z.string(), z.string()).optional(),
    attachment_ids: z.array(z.string()).max(5).nullable().optional(),
    private_chat: z.boolean().optional(),
    options: z.record(z.string(), z.any()).optional(),
  })
  .passthrough();
export type RunRequest = z.infer<typeof runRequestSchema>;

export const attachmentUploadResponseSchema = z.object({
  $schema: z.string().url().optional(),
  id: z.string(),
  mime_type: z.string(),
  size: z.number().int(),
});
export type AttachmentUploadResponse = z.infer<typeof attachmentUploadResponseSchema>;

export const runResponseSchema = z.object({
  $schema: z.string().url().optional(),
  conversation_id: z.union([z.number().int(), z.string(), z.null()]).optional(),
  result: z.union([z.string(), z.null()]).optional(),
  status: z.string(),
  task_id: z.string(),
  trace_id: z.string().optional(),
});
export type RunResponse = z.infer<typeof runResponseSchema>;

export const pendingTaskApprovalSchema = baseTaskApprovalSummarySchema.extend({
  patterns: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type PendingTaskApproval = z.infer<typeof pendingTaskApprovalSchema>;

export const activeTaskSchema = baseTaskSummarySchema.extend({
  computer_use: z.boolean().default(false),
  client_mcp_tools: taskMcpToolSummarySchema.array().optional(),
  pending_approval: pendingTaskApprovalSchema.nullable().optional(),
});
export type ActiveTask = z.infer<typeof activeTaskSchema>;

export const activeTasksResponseSchema = z
  .object({
    $schema: z.string().url().optional(),
    tasks: z.union([z.array(baseTaskSummarySchema), z.null()]),
  })
  .extend({
    tasks: z
      .array(activeTaskSchema)
      .nullable()
      .transform((tasks) => tasks ?? []),
  });
export type ActiveTasksResponse = z.infer<typeof activeTasksResponseSchema>;

export const approveTaskRequestSchema = z.object({
  $schema: z.string().url().optional(),
  approved: z.boolean(),
  error: z.string().optional(),
  result: z.object({}).partial().passthrough().optional(),
});
export type ApproveTaskRequest = z.infer<typeof approveTaskRequestSchema>;

export const financeMemorySchema = z.object({
  id: z.number(),
  content: z.string(),
  type: z.literal('finance'),
});
export type FinanceMemory = z.infer<typeof financeMemorySchema>;

export const memorySchema = z.object({
  id: z.number(),
  content: z.string(),
  type: z.string(),
  metadata: z.unknown().optional().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Memory = z.infer<typeof memorySchema>;

const memoryRequestSchemaShape = {
  content: z.string().trim().min(1),
  type: z.string().trim().min(1),
};

export const updateMemoryRequestSchema = z.object(memoryRequestSchemaShape);
export type UpdateMemoryRequest = z.infer<typeof updateMemoryRequestSchema>;
export const createMemoryRequestSchema = z.object(memoryRequestSchemaShape);
export type CreateMemoryRequest = z.infer<typeof createMemoryRequestSchema>;

export const financePrivacySchema = z.object({
  connected_accounts_available: z.boolean(),
  can_mutate_accounts: z.boolean(),
  training_controls: z.string(),
  data_controls: z.array(z.string()),
});
export type FinancePrivacy = z.infer<typeof financePrivacySchema>;

export const financeConnectionSchema = z.object({
  id: z.number().int(),
  provider: z.string(),
  institution_name: z.string().nullable().optional(),
  last_synced_at: z.string().nullable().optional(),
});
export type FinanceConnection = z.infer<typeof financeConnectionSchema>;

export const financeAccountSchema = z.object({
  provider_account_id: z.string(),
  name: z.string(),
  mask: z.string().nullable().optional(),
  type: z.string().nullable().optional(),
  subtype: z.string().nullable().optional(),
  current_balance: z.number().nullable().optional(),
  available_balance: z.number().nullable().optional(),
  iso_currency_code: z.string().nullable().optional(),
});
export type FinanceAccount = z.infer<typeof financeAccountSchema>;

export const financeTransactionSchema = z.object({
  provider_transaction_id: z.string(),
  provider_account_id: z.string(),
  amount: z.number(),
  iso_currency_code: z.string().nullable().optional(),
  date: z.string(),
  name: z.string(),
  merchant_name: z.string().nullable().optional(),
  primary_category: z.string().nullable().optional(),
  detailed_category: z.string().nullable().optional(),
  pending: z.boolean(),
});
export type FinanceTransaction = z.infer<typeof financeTransactionSchema>;

export const financeRecurringStreamSchema = z.object({
  provider_stream_id: z.string(),
  provider_account_id: z.string(),
  stream_type: z.string(),
  merchant_name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  frequency: z.string().nullable().optional(),
  last_amount: z.number().nullable().optional(),
  iso_currency_code: z.string().nullable().optional(),
  last_date: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
});
export type FinanceRecurringStream = z.infer<typeof financeRecurringStreamSchema>;

export const financeDashboardResponseSchema = z.object({
  connected_accounts: z.boolean(),
  provider_status: z.string(),
  memories: z.array(financeMemorySchema),
  capabilities: z.array(z.string()),
  connections: z.array(financeConnectionSchema).default([]),
  accounts: z.array(financeAccountSchema).default([]),
  recent_transactions: z.array(financeTransactionSchema).default([]),
  recurring_streams: z.array(financeRecurringStreamSchema).default([]),
  privacy: financePrivacySchema,
});
export type FinanceDashboardResponse = z.infer<typeof financeDashboardResponseSchema>;

export const createFinanceMemoryRequestSchema = z.object({
  content: z.string().min(1).max(280),
});
export type CreateFinanceMemoryRequest = z.infer<typeof createFinanceMemoryRequestSchema>;

export const createFinanceLinkTokenResponseSchema = z.object({
  link_token: z.string(),
  expiration: z.string(),
});
export type CreateFinanceLinkTokenResponse = z.infer<typeof createFinanceLinkTokenResponseSchema>;

export const exchangeFinancePublicTokenRequestSchema = z.object({
  public_token: z.string().min(1),
  institution_id: z.string().nullable().optional(),
  institution_name: z.string().nullable().optional(),
});
export type ExchangeFinancePublicTokenRequest = z.infer<
  typeof exchangeFinancePublicTokenRequestSchema
>;

export const conversationSummarySchema = z.object({
  id: z.number(),
  timestamp: z.string(),
  user_input: z.string(),
  result: z.string(),
  execution_time: z.number().optional(),
  model: z.string().optional(),
  agent_count: z.number().optional(),
  projectId: z.number().nullable().optional(),
  isPublic: z.boolean().optional(),
  shareId: z.string().nullable().optional(),
  sources: z.array(sourceReferenceSchema).optional(),
  agentStatuses: z.array(agentStatusSchema).optional(),
  toolEvents: z.array(toolUsageEventSchema).optional(),
});
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;

export const projectSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string().nullable().optional(),
  custom_instructions: z.string().nullable().optional(),
  created_at: z.string(),
});
export type Project = z.infer<typeof projectSchema>;

export const createProjectRequestSchema = z.object({
  name: z.string().min(1, 'Project name is required'),
  description: z.string().optional(),
  custom_instructions: z.string().optional(),
});
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

export const conversationListSchema = z.object({
  conversations: z.array(conversationSummarySchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
  has_more: z.boolean(),
});

export const subscriptionSummarySchema = z.object({
  subscription_id: z.string(),
  status: z.string(),
  current_period_start: billingTimestampSchema.nullable(),
  current_period_end: billingTimestampSchema.nullable(),
  cancel_at_period_end: z.boolean(),
});
export type SubscriptionSummary = z.infer<typeof subscriptionSummarySchema>;

export const subscriptionResponseSchema = z.object({
  subscription: subscriptionSummarySchema.nullable(),
});
export type SubscriptionResponse = z.infer<typeof subscriptionResponseSchema>;

export const createSubscriptionResponseSchema = z.object({
  checkout_url: z.string().min(1),
  subscription_id: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
});
export type CreateSubscriptionResponse = z.infer<typeof createSubscriptionResponseSchema>;

export const productSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  plan: planSchema,
  price_id: z.string().nullable(),
  price_amount: z.number().nullable(),
  price_currency: z.string().nullable(),
});
export type ProductSummary = z.infer<typeof productSummarySchema>;

export const productsResponseSchema = z.object({
  products: z.array(productSummarySchema),
});
export type ProductsResponse = z.infer<typeof productsResponseSchema>;

export const messageResponseSchema = z.object({
  message: z.string(),
});
export type MessageResponse = z.infer<typeof messageResponseSchema>;

export const settingsResponseSchema = z.object({
  success: z.boolean(),
});
export type SettingsResponse = z.infer<typeof settingsResponseSchema>;

export const storageCategorySchema = z.object({
  id: z.string(),
  label: z.string(),
  bytes: z.number(),
  count: z.number(),
});
export type StorageCategory = z.infer<typeof storageCategorySchema>;

export const storageSummarySchema = z.object({
  usedBytes: z.number(),
  quotaBytes: z.number(),
  categories: z.array(storageCategorySchema),
});
export type StorageSummary = z.infer<typeof storageSummarySchema>;

export const modelOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  badge: z.string().min(1),
  description: z.string().optional(),
  usageMultiple: z.number().positive().optional(),
  reasoningEffortLevels: z.array(z.string().min(1)).optional(),
  defaultReasoningEffort: z.string().min(1).optional(),
});
export type ModelOptionSummary = z.infer<typeof modelOptionSchema>;

export const modelSelectorResponseSchema = z.object({
  enabled: z.boolean(),
  options: z.array(modelOptionSchema),
  defaultModelId: z.string().min(1),
});
export type ModelSelectorResponse = z.infer<typeof modelSelectorResponseSchema>;

export const integrationStatusSchema = z.object({
  connected: z.boolean(),
  id: z.string(),
  provider: z.string(),
});
export type IntegrationStatus = z.infer<typeof integrationStatusSchema>;

export const mobileSubscriptionSyncResponseSchema = z.object({
  plan: planSchema,
  subscription_status: z.string().nullable(),
  subscription_source: subscriptionSourceSchema,
  current_period_end: z.string().nullable(),
});
export type MobileSubscriptionSyncResponse = z.infer<typeof mobileSubscriptionSyncResponseSchema>;

export const registerUserSchema = z.object({
  email: z.string().email('Email must be valid'),
  full_name: z.string().min(1, 'Full name is required'),
});
export type RegisterUser = z.infer<typeof registerUserSchema>;

export const createSubscriptionRequestSchema = z.object({
  price_id: z.string().min(1, 'price_id is required'),
});
export type CreateSubscriptionRequest = z.infer<typeof createSubscriptionRequestSchema>;

const pushPlatformSchema = z.enum(['ios', 'android', 'web', 'macos', 'windows', 'unknown']);

export const pushTokenRegistrationSchema = z.object({
  token: z.string().min(1, 'Push token is required'),
  platform: pushPlatformSchema.default('unknown'),
  deviceId: z.string().optional(),
  appVersion: z.string().optional(),
});
export type PushTokenRegistration = z.infer<typeof pushTokenRegistrationSchema>;

export const pushTokenDeleteSchema = z.object({
  token: z.string().min(1, 'Push token is required'),
});
export type PushTokenDeleteRequest = z.infer<typeof pushTokenDeleteSchema>;

export const executionRubricSchema = z.object({
  accuracy: z.number().min(0).max(5),
  completeness: z.number().min(0).max(5),
  confidence: z.number().min(0).max(5),
  risk: z.enum(['low', 'medium', 'high']),
  human_review: z.boolean(),
});

export const executionReportSchema = z.object({
  summary: z.string(),
  key_steps: z.array(
    z.object({
      agent: z.string(),
      action: z.string(),
      observation: z.string(),
    })
  ),
  decisions: z.array(
    z.object({
      agent: z.string(),
      rationale: z.string(),
      outcome: z.string(),
    })
  ),
  rubric: executionRubricSchema,
});

export const executionTraceSchema = z.object({
  id: z.string(),
  task_id: z.string(),
  goal: z.string(),
  plan: z.any(),
  steps: z.any(),
  self_eval: z.any(),
  report: executionReportSchema.optional(),
  artifacts: z.any(),
  created_at: z.string(),
});
export type ExecutionTrace = z.infer<typeof executionTraceSchema>;

export const executionTraceResponseSchema = z.object({
  trace: executionTraceSchema,
});
export type ExecutionTraceResponse = z.infer<typeof executionTraceResponseSchema>;

const readFirstDefined = (value: Record<string, unknown>, keys: string[]): unknown => {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      return value[key];
    }
  }
  return undefined;
};

export const balanceResponseSchema = z
  .record(z.string(), z.unknown())
  .transform((value) => ({
    creditBalance: readFirstDefined(value, ['creditBalance', 'credit_balance']),
    autoRechargeEnabled: readFirstDefined(value, ['autoRechargeEnabled', 'auto_recharge_enabled']),
    autoRechargeAmount: readFirstDefined(value, ['autoRechargeAmount', 'auto_recharge_amount']),
    autoRechargeThreshold: readFirstDefined(value, [
      'autoRechargeThreshold',
      'auto_recharge_threshold',
    ]),
    subscriptionStatus: readFirstDefined(value, ['subscriptionStatus', 'subscription_status']),
    subscriptionId: readFirstDefined(value, ['subscriptionId', 'subscription_id']),
    cancelAtPeriodEnd: readFirstDefined(value, ['cancelAtPeriodEnd', 'cancel_at_period_end']),
    currentPeriodEnd: readFirstDefined(value, ['currentPeriodEnd', 'current_period_end']),
    currentPeriodStart: readFirstDefined(value, ['currentPeriodStart', 'current_period_start']),
  }))
  .pipe(
    z
      .object({
        creditBalance: z.number(),
        autoRechargeEnabled: z.boolean(),
        autoRechargeAmount: z.union([z.number(), z.null(), z.undefined()]),
        autoRechargeThreshold: z.union([z.number(), z.null(), z.undefined()]),
        subscriptionStatus: z.union([z.string(), z.null(), z.undefined()]),
        subscriptionId: z.union([z.string(), z.null(), z.undefined()]),
        cancelAtPeriodEnd: z.boolean(),
        currentPeriodEnd: z.union([billingTimestampSchema, z.null(), z.undefined()]),
        currentPeriodStart: z.union([billingTimestampSchema, z.null(), z.undefined()]),
      })
      .transform((value) => ({
        creditBalance: value.creditBalance,
        autoRechargeEnabled: value.autoRechargeEnabled,
        autoRechargeAmount: value.autoRechargeAmount ?? null,
        autoRechargeThreshold: value.autoRechargeThreshold ?? null,
        subscriptionStatus: value.subscriptionStatus ?? null,
        subscriptionId: value.subscriptionId ?? null,
        cancelAtPeriodEnd: value.cancelAtPeriodEnd,
        currentPeriodEnd: value.currentPeriodEnd ?? null,
        currentPeriodStart: value.currentPeriodStart ?? null,
      }))
  );
export type BalanceResponse = z.infer<typeof balanceResponseSchema>;

export const paymentMethodResponseSchema = z
  .record(z.string(), z.unknown())
  .transform((value) => ({
    id: readFirstDefined(value, ['id']),
    brand: readFirstDefined(value, ['brand']),
    last4: readFirstDefined(value, ['last4']),
    expMonth: readFirstDefined(value, ['expMonth', 'exp_month']),
    expYear: readFirstDefined(value, ['expYear', 'exp_year']),
    isDefault: readFirstDefined(value, ['isDefault', 'is_default']),
  }))
  .pipe(
    z.object({
      id: z.string(),
      brand: z.string(),
      last4: z.string(),
      expMonth: z.number(),
      expYear: z.number(),
      isDefault: z.boolean(),
    })
  );
export type PaymentMethodResponse = z.infer<typeof paymentMethodResponseSchema>;

export const invoiceResponseSchema = z
  .record(z.string(), z.unknown())
  .transform((value) => ({
    id: readFirstDefined(value, ['id']),
    number: readFirstDefined(value, ['number']),
    amountPaid: readFirstDefined(value, ['amountPaid', 'amount_paid']),
    currency: readFirstDefined(value, ['currency']),
    status: readFirstDefined(value, ['status']),
    createdAt: readFirstDefined(value, ['createdAt', 'created_at']),
    invoicePdf: readFirstDefined(value, ['invoicePdf', 'invoice_pdf']),
    hostedUrl: readFirstDefined(value, ['hostedUrl', 'hosted_url']),
  }))
  .pipe(
    z.object({
      id: z.string(),
      number: z.string(),
      amountPaid: z.number(),
      currency: z.string(),
      status: z.string(),
      createdAt: billingTimestampSchema,
      invoicePdf: z.string(),
      hostedUrl: z.string(),
    })
  );
export type InvoiceResponse = z.infer<typeof invoiceResponseSchema>;

export const autoRechargeRequestSchema = z.object({
  enabled: z.boolean(),
  amount: z.number().nullable(),
  threshold: z.number().nullable(),
});
export type AutoRechargeRequest = z.infer<typeof autoRechargeRequestSchema>;

export const portalResponseSchema = z.object({
  url: z.string(),
});
export type PortalResponse = z.infer<typeof portalResponseSchema>;
