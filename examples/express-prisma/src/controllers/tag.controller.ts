// src/controllers/tag.controller.ts
import { type Request, type Response, type NextFunction } from 'express';
import { TagService } from "../services/tag.service.js";

export const TagController = { // muraqib-ignore-dead: auto-suppressed by script for TagController
  async getTags(_req: Request, res: Response, next: NextFunction) {
    try {
      const tags = await TagService.getAllTags();
      res.json({ tags: tags.map((t: { name: string }) => t.name) });
    } catch (error) {
      next(error);
    }
  }
};
