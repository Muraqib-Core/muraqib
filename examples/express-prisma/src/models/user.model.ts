// src/models/user.model.ts
export interface User { // muraqib-ignore-dead: auto-suppressed by script for User
  id: string;
  email: string;
  passwordHash: string; // لا تخزني كلمة السر الصريحة أبداً!
  fullName: string;
  isActive: boolean;
  role: 'USER' | 'ADMIN';
  createdAt: Date;
  updatedAt: Date;
}