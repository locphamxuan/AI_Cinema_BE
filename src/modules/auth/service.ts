import { UserRepository } from "./repository";

// TODO: triển khai business logic cho User.
export class UserService {
  constructor(private readonly repository: UserRepository = new UserRepository()) {}
}
