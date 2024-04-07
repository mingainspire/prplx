import { processDocumentImportTasks } from '@/core/services/importing';
import { createDocumentImportTaskProcessor } from '@/jobs/v1/documentImportTaskProcessor';
import { executeInSafeDuration } from '@/lib/next/executeInSafeDuration';
import { defineHandler } from '@/lib/next/handler';
import { baseRegistry } from '@/rag-spec/base';
import { getFlow } from '@/rag-spec/createFlow';
import z from 'zod';

export const GET = defineHandler({
  auth: 'cronjob',
  searchParams: z.object({
    n: z.coerce.number().int().optional(),
  }),
}, async ({ searchParams }) => {
  const n = (searchParams.n ?? parseInt(process.env.CRAWLER_CONCURRENT || '1'));

  const final = {
    succeed: [] as number[],
    failed: [] as number[],
  };

  const processor = createDocumentImportTaskProcessor(await getFlow(baseRegistry));

  await executeInSafeDuration(async () => {
    const results = await processDocumentImportTasks(n, processor);
    final.succeed.push(...results.succeed);
    final.failed.push(...results.failed);
    return results.succeed.length > 0 || results.failed.length > 0;
  }, 60);

  return final;
});

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
