import { z } from 'zod';
import {
  COMMISSION_MODES, COUNTERPARTY_TIERS, CUSTOMER_TX_TYPES, HAWALA_TYPES,
  INVESTMENT_TYPES, PNL_PERIODS, SENDER_MODES
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
  fromCity: cityCode,
  toCity: cityCode,
  amount: positiveAmount,
  currency: assetCode,
  receiverName: shortText.min(1),
  senderMode: z.enum([SENDER_MODES.CASH, SENDER_MODES.ACCOUNT]).default(SENDER_MODES.CASH),
  senderName: shortText.optional(),
  senderCustomerId: uuid.optional(),
  commissionMode: z.enum([COMMISSION_MODES.PERCENT, COMMISSION_MODES.FIXED])
    .default(COMMISSION_MODES.PERCENT),
  commissionPct: z.coerce.number().nonnegative().max(100).optional(),
  commissionFixed: nonNegativeAmount.optional(),
  note: noteText.optional()
}).superRefine((v, ctx) => {
  if (v.senderMode === SENDER_MODES.ACCOUNT && !v.senderCustomerId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['senderCustomerId'], message: 'Required when senderMode is "account"' });
  }
  if (v.senderMode === SENDER_MODES.CASH && !v.senderName?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['senderName'], message: 'Required when senderMode is "cash"' });
  }
  if (v.commissionMode === COMMISSION_MODES.FIXED && v.commissionFixed === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['commissionFixed'], message: 'Required when commissionMode is "fixed"' });
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

export const createTransactionSchema = z.object({
  type: z.enum([
    CUSTOMER_TX_TYPES.DEPOSIT, CUSTOMER_TX_TYPES.WITHDRAWAL,
    CUSTOMER_TX_TYPES.CHARGE, CUSTOMER_TX_TYPES.CREDIT
  ]),
  amount: positiveAmount,
  currency: assetCode,
  note: noteText.optional(),
  conversion: z.object({
    toCurrency: assetCode,
    rate: positiveAmount
  }).optional()
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
  kind: z.enum(['hawala', 'settle', 'custtx', 'fx']).optional(),
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
  kind: z.enum(['hawala', 'settle', 'custtx', 'fx']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional()
});
