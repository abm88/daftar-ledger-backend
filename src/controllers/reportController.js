import { asyncHandler } from '../utils/asyncHandler.js';
import { reportService } from '../services/reportService.js';
import { statementService } from '../services/statementService.js';

export const reportController = {
  pnl: asyncHandler(async (req, res) => {
    const pnl = await reportService.pnl(req.userId, req.query.period);
    res.json(pnl);
  }),

  activity: asyncHandler(async (req, res) => {
    const feed = await reportService.activityFeed(req.userId, {
      kind: req.query.kind,
      search: req.query.search,
      from: req.query.from,
      to: req.query.to,
      limit: req.query.limit ?? 100,
      offset: req.query.offset ?? 0
    });
    res.json(feed);
  }),

  dashboard: asyncHandler(async (req, res) => {
    const dashboard = await reportService.dashboard(req.userId);
    res.json(dashboard);
  }),

  ledgerStatement: asyncHandler(async (req, res) => {
    const statement = await statementService.ledgerStatement(req.userId, req.query);
    res.json(statement);
  })
};
