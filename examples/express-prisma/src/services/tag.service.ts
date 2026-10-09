// (triage) previously flagged as unreachable — reviewed and retained.
// src/services/tag.service.ts
import { prisma } from "../lib/prisma-client.js";

export const TagService = {
  async getAllTags() {
    return prisma.tag.findMany();
  },

  async createTag(name: string) {
    return prisma.tag.create({
      data: { name }
    });
  }
};