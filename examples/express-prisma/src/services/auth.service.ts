// muraqib-unreachable: flagged by automated triage. Review before removal.
import * as bcrypt from 'bcryptjs';
import type { RegisterInput } from '../models/register-input.model.js';
import type { UserRepository } from '../repositories/user.repository.js';
import HttpException from '../models/http-exception.model.js';

export class AuthService {
  constructor(private userRepository: UserRepository) {}

  async register(input: RegisterInput) {
    const hashedPassword = await bcrypt.hash(input.password, 10);
    
    try {
      const user = await this.userRepository.create({
        ...input,
        password: hashedPassword,
      });
      return user;
    } catch (_error) {
    throw new HttpException(422, { errors: { email: ['could not create user'] } });
    }
  }
}