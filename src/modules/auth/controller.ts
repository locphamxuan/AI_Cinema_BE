import { UserService } from "./service";

// TODO: triển khai handler cho từng endpoint của User.
export class UserController {
  constructor(private readonly service: UserService = new UserService()) {}
}
