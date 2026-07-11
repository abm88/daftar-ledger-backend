import { asyncHandler } from '../utils/asyncHandler.js';
import { authService } from '../services/authService.js';

export const authController = {
  register: asyncHandler(async (req, res) => {
    const result = await authService.register(req.body);
    res.status(201).json(result);
  }),

  login: asyncHandler(async (req, res) => {
    const result = await authService.login(req.body);
    res.json(result);
  }),

  logout: asyncHandler(async (req, res) => {
    await authService.logout(req.sessionId);
    res.json({ message: 'Signed out' });
  }),

  me: asyncHandler(async (req, res) => {
    const user = await authService.getProfile(req.userId);
    res.json({ user });
  }),

  updateProfile: asyncHandler(async (req, res) => {
    const user = await authService.updateProfile(req.userId, req.body);
    res.json({ user });
  }),

  changePassword: asyncHandler(async (req, res) => {
    await authService.changePassword(req.userId, req.sessionId, req.body);
    res.json({ message: 'Password updated' });
  })
};
