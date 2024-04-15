import { DocumentIndexService } from '@/core/services/indexing';
import { executeInSafeDuration } from '@/lib/next/executeInSafeDuration';
import { defineHandler } from '@/lib/next/handler';
import z from 'zod';

export const GET = defineHandler({
  auth: 'cronjob',
  searchParams: z.object({
    n: z.coerce.number().int().optional(),
  }),
}, async ({ searchParams }) => {
  const n = (searchParams.n ?? parseInt(process.env.INDEX_CONCURRENT || '1'));

  const final = {
    succeed: [] as number[],
    failed: [] as number[],
  };

  const service = new DocumentIndexService();
  await service.prepareProviders();

  await executeInSafeDuration(async () => {
    const results = await service.runDocumentIndexTasks(n);
    final.succeed.push(...results.succeed);
    final.failed.push(...results.failed);
    return results.succeed.length > 0;
  }, 60, 0.8, 'document_index_tasks');

  return final;
});

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
