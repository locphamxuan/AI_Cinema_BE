jest.mock('./auth.service', () => ({
  AuthService: class AuthService {},
}));

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  const register = jest.fn();
  const login = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AuthController({ register, login } as unknown as AuthService);
  });

  it('should delegate register to the auth service', async () => {
    const payload = {
      email: 'user@example.com',
      password: 'StrongPass123!',
      fullName: 'Jane Doe',
    };

    const result = { user: { id: '1', email: payload.email, fullName: payload.fullName } };
    register.mockResolvedValue(result);

    await expect(controller.register(payload)).resolves.toEqual(result);
    expect(register).toHaveBeenCalledWith(payload);
  });

  it('should delegate login to the auth service', async () => {
    const payload = {
      email: 'user@example.com',
      password: 'StrongPass123!',
    };

    const result = { accessToken: 'demo-token', user: { id: '1', email: payload.email } };
    login.mockResolvedValue(result);

    await expect(controller.login(payload)).resolves.toEqual(result);
    expect(login).toHaveBeenCalledWith(payload);
  });
});
