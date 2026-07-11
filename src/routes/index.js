import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as schemas from '../validators/schemas.js';

import { authController } from '../controllers/authController.js';
import { assetController } from '../controllers/assetController.js';
import { rateController } from '../controllers/rateController.js';
import { cashDrawerController } from '../controllers/cashDrawerController.js';
import { counterpartyController } from '../controllers/counterpartyController.js';
import { hawalaController } from '../controllers/hawalaController.js';
import { customerController } from '../controllers/customerController.js';
import { transactionController } from '../controllers/transactionController.js';
import { fxController } from '../controllers/fxController.js';
import { investmentController } from '../controllers/investmentController.js';
import { settingsController } from '../controllers/settingsController.js';
import { reportController } from '../controllers/reportController.js';
import { referenceController } from '../controllers/referenceController.js';
import { setupController } from '../controllers/setupController.js';

export const apiRouter = Router();

// ---- Auth --------------------------------------------------------------
apiRouter.post('/auth/register', validate(schemas.registerSchema), authController.register);
apiRouter.post('/auth/login', validate(schemas.loginSchema), authController.login);
apiRouter.post('/auth/logout', requireAuth, authController.logout);
apiRouter.get('/auth/me', requireAuth, authController.me);
apiRouter.put('/auth/me', requireAuth, validate(schemas.updateProfileSchema), authController.updateProfile);
apiRouter.put('/auth/me/password', requireAuth, validate(schemas.changePasswordSchema), authController.changePassword);

// ---- Reference data ------------------------------------------------------
apiRouter.get('/cities', referenceController.cities);

// Everything below is per-saraf data.
apiRouter.use(requireAuth);

// ---- First-run shop setup (3-step wizard) -----------------------------------
apiRouter.get('/setup/status', setupController.status);
apiRouter.post('/setup', validate(schemas.setupSchema), setupController.complete);

// ---- Assets & rates -------------------------------------------------------
apiRouter.get('/assets', assetController.list);
apiRouter.patch('/assets/:code/activation', validate(schemas.assetActivationSchema), assetController.setActivation);

apiRouter.get('/rates', rateController.list);
apiRouter.put('/rates', validate(schemas.updateRatesSchema), rateController.update);
apiRouter.get('/rates/history', validate(schemas.rateHistoryQuery, 'query'), rateController.history);

// ---- Cash drawer -----------------------------------------------------------
apiRouter.get('/cash-drawer', cashDrawerController.get);
apiRouter.put('/cash-drawer/count', validate(schemas.cashCountSchema), cashDrawerController.recordCount);
apiRouter.post('/cash-drawer/initial-setup', validate(schemas.initialSetupSchema), cashDrawerController.initialSetup);
apiRouter.get('/cash-drawer/today-movement', cashDrawerController.todayMovement);

// ---- Counterparties (fellow sarafs) ---------------------------------------
apiRouter.get('/counterparties', counterpartyController.list);
apiRouter.post('/counterparties', validate(schemas.createCounterpartySchema), counterpartyController.create);
apiRouter.get('/counterparties/:id', validate(schemas.idParam, 'params'), counterpartyController.get);
apiRouter.put('/counterparties/:id', validate(schemas.idParam, 'params'), validate(schemas.updateCounterpartySchema), counterpartyController.update);
apiRouter.delete('/counterparties/:id', validate(schemas.idParam, 'params'), counterpartyController.remove);
apiRouter.get('/counterparties/:id/hawalas', validate(schemas.idParam, 'params'), counterpartyController.hawalas);
apiRouter.post('/counterparties/:id/settle', validate(schemas.idParam, 'params'), validate(schemas.settleSchema), counterpartyController.settle);
apiRouter.get('/counterparties/:id/statement', validate(schemas.idParam, 'params'), validate(schemas.statementRangeQuery, 'query'), counterpartyController.statement);

// ---- Hawalas ---------------------------------------------------------------
apiRouter.get('/hawalas', validate(schemas.hawalaListQuery, 'query'), hawalaController.list);
apiRouter.get('/hawalas/pending', hawalaController.pending);
apiRouter.get('/hawalas/next-code', hawalaController.nextCode);
apiRouter.post('/hawalas', validate(schemas.issueHawalaSchema), hawalaController.issue);
apiRouter.get('/hawalas/:id', validate(schemas.idParam, 'params'), hawalaController.get);
apiRouter.post('/hawalas/:id/mark-paid', validate(schemas.idParam, 'params'), hawalaController.markPaid);

// ---- Customers & their transactions ----------------------------------------
apiRouter.get('/customers', customerController.list);
apiRouter.post('/customers', validate(schemas.createCustomerSchema), customerController.create);
apiRouter.get('/customers/:id', validate(schemas.idParam, 'params'), customerController.get);
apiRouter.put('/customers/:id', validate(schemas.idParam, 'params'), validate(schemas.updateCustomerSchema), customerController.update);
apiRouter.delete('/customers/:id', validate(schemas.idParam, 'params'), customerController.remove);
apiRouter.get('/customers/:id/transactions', validate(schemas.idParam, 'params'), customerController.transactions);
apiRouter.post('/customers/:id/transactions', validate(schemas.idParam, 'params'), validate(schemas.createTransactionSchema), customerController.addTransaction);
apiRouter.get('/customers/:id/statement', validate(schemas.idParam, 'params'), validate(schemas.statementRangeQuery, 'query'), customerController.statement);

apiRouter.get('/transactions/:id', validate(schemas.idParam, 'params'), transactionController.get);
apiRouter.delete('/transactions/:id', validate(schemas.idParam, 'params'), transactionController.remove);
apiRouter.get('/transactions/:id/receipt', validate(schemas.idParam, 'params'), transactionController.receipt);

// ---- FX trading -------------------------------------------------------------
apiRouter.get('/fx/trades', fxController.list);
apiRouter.post('/fx/trades', validate(schemas.createFxTradeSchema), fxController.create);
apiRouter.get('/fx/positions', fxController.positions);

// ---- Investments (owner equity) ----------------------------------------------
apiRouter.get('/investments', investmentController.list);
apiRouter.post('/investments', validate(schemas.createInvestmentSchema), investmentController.create);

// ---- Settings -----------------------------------------------------------------
apiRouter.get('/settings', settingsController.get);
apiRouter.put('/settings', validate(schemas.updateSettingsSchema), settingsController.update);

// ---- Reports & statements -------------------------------------------------------
apiRouter.get('/reports/dashboard', reportController.dashboard);
apiRouter.get('/reports/pnl', validate(schemas.pnlQuery, 'query'), reportController.pnl);
apiRouter.get('/reports/activity', validate(schemas.activityQuery, 'query'), reportController.activity);
apiRouter.get('/reports/ledger-statement', validate(schemas.ledgerStatementQuery, 'query'), reportController.ledgerStatement);
