import { PrismaClient } from '@prisma/client';
import type { User, UserInput, UserRepository } from './user.repository.js';

const prisma = new PrismaClient();

export class PrismaUserRepository implements UserRepository {
  async findByEmail(email: string): Promise<User | null> {
    const user = await prisma.user.findUnique({ where: { email } });
    return user as User | null;
  }
  
  async create(data: UserInput): Promise<User> {
    const user = await prisma.user.create({ data });
    return user as User;
  }
}