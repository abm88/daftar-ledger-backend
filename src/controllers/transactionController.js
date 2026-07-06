import { asyncHandler } from '../utils/asyncHandler.js';
import { customerService } from '../services/customerService.js';

export const transactionController = {
  get: asyncHandler(async (req, res) => {
    const transaction = await customerService.getTransaction(req.userId, req.params.id);
    res.json({ transaction });
  }),

  remove: asyncHandler(async (req, res) => {
    const result = await customerService.deleteTransaction(req.userId, req.params.id);
    res.json({ deleted: true, ...result });
  }),

  /** Plain-text receipt matching the app's copy-receipt format. */
  receipt: asyncHandler(async (req, res) => {
    const tx = await customerService.getTransaction(req.userId, req.params.id);
    const gave = ['withdrawal', 'charge', 'credit'].includes(tx.type);
    const lines = [
      `Daftar — ${gave ? 'You Gave' : 'You Received'}`,
      tx.customerName,
      `${gave ? '−' : '+'}${tx.amount} ${tx.currency}`,
      new Date(tx.createdAt).toISOString(),
      ...(tx.note ? [tx.note] : []),
      `New balance: ${tx.balanceAfter >= 0 ? '+' : '−'}${Math.abs(tx.balanceAfter)} ${tx.currency}`
    ];
    res.json({ receipt: lines.join('\n'), transaction: tx });
  })
};
