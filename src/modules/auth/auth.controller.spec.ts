jest.mock('./auth.service', () => ({
  AuthService: class AuthService {},
}));

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let service: jest.Mocked<AuthService>;

  beforeEach(() => {
    service = {
      register: jest.fn(),
      login: jest.fn(),
    } as unknown as jest.Mocked<AuthService>;

    controller = new AuthController(service);
  });

  it('should delegate register to the auth service', async () => {
    const payload = {
      email: 'user@example.com',
      password: 'StrongPass123!',
      fullName: 'Jane Doe',
    };

    const result = { user: { id: '1', email: payload.email, fullName: payload.fullName } };
    service.register.mockResolvedValue(result as any);

    await expect(controller.register(payload)).resolves.toEqual(result);
    expect(service.register).toHaveBeenCalledWith(payload);
  });

  it('should delegate login to the auth service', async () => {
    const payload = {
      email: 'user@example.com',
      password: 'StrongPass123!',
    };

    const result = { accessToken: 'demo-token', user: { id: '1', email: payload.email } };
    service.login.mockResolvedValue(result as any);

    await expect(controller.login(payload)).resolves.toEqual(result);
    expect(service.login).toHaveBeenCalledWith(payload);
  });
});
