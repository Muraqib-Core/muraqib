export interface User {
  id: string;
  email: string;
  name?: string;
}

export interface UserInput {
  email: string;
  name?: string;
  password?:string;
}

export interface UserRepository {
  findByEmail(email: string): Promise<User | null>;
  create(data: UserInput): Promise<User>;
}