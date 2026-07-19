import { z } from 'zod';
import {
  COMMISSION_MODES, COUNTERPARTY_TIERS, CUSTOMER_STATUS_FILTERS, CUSTOMER_TX_TYPES,
  HAWALA_TYPES, INVESTMENT_TYPES, PAYOUT_METHODS, PNL_PERIODS, SENDER_MODES, TEAM_ROLES
} from '../config/constants.js';

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

const assetCode = z.string().trim().min(2).max(12).toUpperCase();
const cityCode = z.string().trim().min(2).max(8).toUpperCase();
const positiveAmount = z.coerce.number().positive().finite();
const nonNegativeAmount = z.coerce.number().nonnegative().finite();
const uuid = z.string().uuid();
const shortText = z.string().trim().max(200);
const noteText = z.string().trim().max(2000);
const phone = z.string().trim().min(5).max(32);

/** { USD: 1200, AFN: -50000 } — signed opening balances per asset. */
const signedBalanceMap = z.record(assetCode, z.coerce.number().finite());
/** { USD: 1200 } — strictly positive amounts per asset. */
const positiveBalanceMap = z.record(assetCode, positiveAmount);
/** { USD: 12450.5 } — zero allowed (counting an empty drawer slot). */
const countMap = z.record(assetCode, nonNegativeAmount);

export const idParam = z.object({ id: uuid });

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

const email = z.string().trim().toLowerCase().email().max(200);
// Prototype signup enforces "at least 6 characters" — keep the API in sync.
const password = z.string().min(6, 'Password must be at least 6 characters').max(128);

export const registerSchema = z.object({
  email,
  password,
  name: shortText.min(1),
  phone: phone.optional(),
  shopName: shortText.optional(),
  cityCode: cityCode.optional(),
  registrationNo: shortText.optional()
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1)
});

export const updateProfileSchema = z.object({
  name: shortText.min(1).optional(),
  shopName: shortText.optional(),
  cityCode: cityCode.optional(),
  registrationNo: shortText.optional(),
  email: email.optional(),
  phone: phone.optional()
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: password
});

// ---------------------------------------------------------------------------
// Assets / rates / settings
// ---------------------------------------------------------------------------

export const assetActivationSchema = z.object({ active: z.boolean() });

export const updateRatesSchema = z.object({
  rates: z.record(
    assetCode,
    z.object({ buy: positiveAmount, sell: positiveAmount })
  ).refine((r) => Object.keys(r).length > 0, { message: 'Provide at least one rate' })
});

export const rateHistoryQuery = z.object({
  asset: assetCode.optional(),
  limit: z.coerce.number().int().positive().max(500).optional()
});

export const updateSettingsSchema = z.object({
  reportingCurrency: assetCode.optional(),
  tradeCurrency: assetCode.optional()
}).refine((v) => v.reportingCurrency || v.tradeCurrency, {
  message: 'Provide reportingCurrency and/or tradeCurrency'
});

// ---------------------------------------------------------------------------
// Cash drawer & first-run setup
// ---------------------------------------------------------------------------

export const cashCountSchema = z.object({ counts: countMap });
export const initialSetupSchema = z.object({ amounts: positiveBalanceMap });

/** The 3-step shop wizard: assets → default currencies → opening amounts. */
export const setupSchema = z.object({
  activeAssets: z.array(assetCode).min(1),
  reportingCurrency: assetCode,
  tradeCurrency: assetCode,
  amounts: positiveBalanceMap.refine((m) => Object.keys(m).length > 0, {
    message: 'Enter at least one opening amount'
  })
});

// ---------------------------------------------------------------------------
// Counterparties
// ---------------------------------------------------------------------------

export const createCounterpartySchema = z.object({
  name: shortText.min(1),
  shortName: shortText.optional(),
  initial: z.string().trim().max(8).optional(),
  phone: phone.optional(),
  cityCode,
  tier: z.enum(COUNTERPARTY_TIERS).optional(),
  openingBalances: signedBalanceMap.optional()
});

export const updateCounterpartySchema = z.object({
  name: shortText.min(1).optional(),
  shortName: shortText.optional(),
  initial: z.string().trim().max(8).optional(),
  phone: phone.optional(),
  cityCode: cityCode.optional(),
  tier: z.enum(COUNTERPARTY_TIERS).optional()
});

export const settleSchema = z.object({
  settleCurrency: assetCode.optional(),
  note: noteText.optional()
});

// ---------------------------------------------------------------------------
// Hawalas
// ---------------------------------------------------------------------------

export const issueHawalaSchema = z.object({
  type: z.enum([HAWALA_TYPES.SEND, HAWALA_TYPES.RECV]),
  counterpartyId: uuid,
  // Route (from → to) is auto-derived from direction + the counterparty branch
  // server-side; these are accepted only as a fallback when the saraf's own
  // city is unknown, and otherwise ignored.
  fromCity: cityCode.optional(),
  toCity: cityCode.optional(),
  amount: positiveAmount,
  currency: assetCode,
  receiverName: shortText.min(1),
  // Received hawalas carry the origin branch's pickup code (entered by the
  // saraf); sent hawalas claim the next code from the per-user sequence.
  code: z.string().trim().min(1).max(6).optional(),
  senderMode: z.enum([SENDER_MODES.CASH, SENDER_MODES.ACCOUNT]).default(SENDER_MODES.CASH),
  senderName: shortText.optional(),
  senderCustomerId: uuid.optional(),
  commissionMode: z.enum([COMMISSION_MODES.PERCENT, COMMISSION_MODES.FIXED])
    .default(COMMISSION_MODES.PERCENT),
  commissionPct: z.coerce.number().nonnegative().max(100).optional(),
  commissionFixed: nonNegativeAmount.optional(),
  note: noteText.optional()
}).superRefine((v, ctx) => {
  const isRecv = v.type === HAWALA_TYPES.RECV;
  if (isRecv) {
    // Receive is a two-phase flow: recorded now, paid out later. It needs the
    // origin code and both names; account funding never applies at record time.
    if (!v.code?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['code'], message: 'Pickup code is required for received hawalas' });
    }
    if (!v.senderName?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['senderName'], message: 'Sender name is required for received hawalas' });
    }
  } else if (v.senderMode === SENDER_MODES.ACCOUNT && !v.senderCustomerId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['senderCustomerId'], message: 'Required when senderMode is "account"' });
  } else if (v.senderMode === SENDER_MODES.CASH && !v.senderName?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['senderName'], message: 'Required when senderMode is "cash"' });
  }
  if (v.commissionMode === COMMISSION_MODES.FIXED && v.commissionFixed === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['commissionFixed'], message: 'Required when commissionMode is "fixed"' });
  }
});

/** Body for POST /hawalas/:id/mark-paid — payout of a pending hawala. */
export const payoutHawalaSchema = z.object({
  method: z.enum([PAYOUT_METHODS.CASH, PAYOUT_METHODS.ACCOUNT]).default(PAYOUT_METHODS.CASH),
  payoutCustomerId: uuid.optional()
}).superRefine((v, ctx) => {
  if (v.method === PAYOUT_METHODS.ACCOUNT && !v.payoutCustomerId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['payoutCustomerId'], message: 'Required when method is "account"' });
  }
});

export const hawalaListQuery = z.object({
  status: z.enum(['pending', 'paid']).optional(),
  currency: assetCode.optional(),
  counterpartyId: uuid.optional(),
  search: z.string().trim().max(100).optional(),
  includeOpening: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().nonnegative().optional()
});

// ---------------------------------------------------------------------------
// Customers & transactions
// ---------------------------------------------------------------------------

export const customerListQuery = z.object({
  search: z.string().trim().max(100).optional(),
  city: cityCode.optional(),
  status: z.enum(CUSTOMER_STATUS_FILTERS).optional()
});

export const createCustomerSchema = z.object({
  name: shortText.min(1),
  shortName: shortText.optional(),
  initial: z.string().trim().max(8).optional(),
  phone: phone.optional(),
  cityCode,
  notes: noteText.optional(),
  openingBalances: positiveBalanceMap.optional()
});

export const updateCustomerSchema = z.object({
  name: shortText.min(1).optional(),
  shortName: shortText.optional(),
  initial: z.string().trim().max(8).optional(),
  phone: phone.optional(),
  cityCode: cityCode.optional(),
  notes: noteText.optional()
});

/** A photo attachment: an image data URL or a hosted URL. */
const photoValue = z.string().trim().min(1).max(2_000_000);
/** Up to 10 attachments per transaction, matching the app. */
const photosArray = z.array(photoValue).max(10);

export const createTransactionSchema = z.object({
  type: z.enum([
    CUSTOMER_TX_TYPES.DEPOSIT, CUSTOMER_TX_TYPES.WITHDRAWAL,
    CUSTOMER_TX_TYPES.CHARGE, CUSTOMER_TX_TYPES.CREDIT
  ]),
  amount: positiveAmount,
  currency: assetCode,
  note: noteText.optional(),
  // Optional attachments: `photos` is the array form; `photo` is the legacy
  // single-value form kept for backward compatibility. Either may be sent.
  photos: photosArray.optional(),
  photo: photoValue.optional(),
  conversion: z.object({
    toCurrency: assetCode,
    rate: positiveAmount
  }).optional()
});

// ---------------------------------------------------------------------------
// Team members & expenses
// ---------------------------------------------------------------------------

export const createTeamMemberSchema = z.object({
  name: shortText.min(1),
  role: z.enum(TEAM_ROLES).optional(),
  phone: phone.optional(),
  initial: z.string().trim().max(8).optional()
});

export const updateTeamMemberSchema = z.object({
  name: shortText.min(1).optional(),
  role: z.enum(TEAM_ROLES).optional(),
  phone: phone.optional(),
  initial: z.string().trim().max(8).optional()
}).refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update' });

export const createExpenseSchema = z.object({
  teamMemberId: uuid,
  amount: positiveAmount,
  currency: assetCode,
  note: noteText.optional()
});

export const expenseListQuery = z.object({
  teamMemberId: uuid.optional()
});

// ---------------------------------------------------------------------------
// FX & investments
// ---------------------------------------------------------------------------

export const createFxTradeSchema = z.object({
  fromCurrency: assetCode,
  toCurrency: assetCode,
  fromAmount: positiveAmount,
  rate: positiveAmount,
  note: noteText.optional()
});

export const createInvestmentSchema = z.object({
  assetCode,
  amount: positiveAmount,
  type: z.enum([INVESTMENT_TYPES.OPENING, INVESTMENT_TYPES.ADDITION, INVESTMENT_TYPES.WITHDRAWAL]),
  note: noteText.optional()
});

// ---------------------------------------------------------------------------
// Reports & statements
// ---------------------------------------------------------------------------

export const pnlQuery = z.object({ period: z.enum(PNL_PERIODS).default('all') });

export const activityQuery = z.object({
  kind: z.enum(['hawala', 'settle', 'custtx', 'fx', 'expense']).optional(),
  search: z.string().trim().max(100).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
  offset: z.coerce.number().int().nonnegative().optional()
});

export const statementRangeQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional()
});

export const ledgerStatementQuery = z.object({
  period: z.enum(PNL_PERIODS).default('all'),
  kind: z.enum(['hawala', 'settle', 'custtx', 'fx', 'expense']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional()
});
