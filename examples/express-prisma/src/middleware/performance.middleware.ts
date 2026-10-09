// src/middlewares/performance.middleware.ts
import type { Request, Response, NextFunction } from 'express';

export const performanceMonitor = (req: Request, res: Response, next: NextFunction) => {
  const start = process.hrtime();

  res.on('finish', () => {
    const diff = process.hrtime(start);
    const timeInMs = (diff[0] * 1e3 + diff[1] * 1e-6).toFixed(3);
    
    // 1. فحص الضغط (بناءً على فكرة الـ Compression في الملف)
    const isCompressed = res.getHeader('content-encoding');
    
    // 2. فحص زمن الـ TTFB (بناءً على فكرة الفصل)
    console.log(`[مراقب] الطلب: ${req.method} ${req.originalUrl}`);
    console.log(`   - زمن الاستجابة: ${timeInMs}ms`);
    console.log(`   - الضغط (Compression): ${isCompressed ? 'مفعل (' + isCompressed + ')' : 'غير مفعل ⚠️'}`);
    
    if (parseFloat(timeInMs) > 200) {
        console.warn(`   - تحذير: الـ TTFB مرتفع! راجع إعدادات السيرفر`);
    }
  });

  next();
};